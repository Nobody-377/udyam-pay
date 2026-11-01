import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
} from '../../common/errors';
import { assertTransition } from '../applications/application-state-machine';
import type { AppStores } from '../persistence/stores';

export interface ProcessWebhookParams {
  lenderCode: string;
  rawPayload: string;
  signatureHeader?: string;
  timestampHeader?: string;
}

export interface WebhookResult {
  eventId: string;
  processed: boolean;
  duplicate: boolean;
  status: string;
}

export class WebhookService {
  constructor(
    private readonly stores: AppStores,
    private readonly toleranceSeconds = 300,
  ) {}

  verifySignature(
    secret: string,
    rawPayload: string,
    signatureHeader?: string,
    timestampHeader?: string,
  ): boolean {
    if (!signatureHeader) return false;

    // Timestamp freshness verification (replay attack defense)
    if (timestampHeader) {
      const ts = Number(timestampHeader);
      if (!Number.isFinite(ts)) return false;
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - ts) > this.toleranceSeconds) {
        return false;
      }
    }

    const payloadToSign = timestampHeader ? `${timestampHeader}.${rawPayload}` : rawPayload;
    const expected = createHmac('sha256', secret).update(payloadToSign).digest('hex');

    const cleanSignature = signatureHeader.replace(/^sha256=/, '').trim();
    if (expected.length !== cleanSignature.length) return false;

    return timingSafeEqual(
      new Uint8Array(Buffer.from(expected, 'hex')),
      new Uint8Array(Buffer.from(cleanSignature, 'hex')),
    );
  }

  async processWebhook(params: ProcessWebhookParams): Promise<WebhookResult> {
    const { lenderCode, rawPayload, signatureHeader, timestampHeader } = params;

    const lender = await this.stores.lenders.findByCode(lenderCode);
    if (!lender) throw new NotFoundError(`Lender ${lenderCode} not found`);

    const config = await this.stores.lenders.getConfig(lender.id);
    const secretRef = config?.secretRef;
    let secret: string | undefined = secretRef ? process.env[secretRef] : undefined;

    const isProduction = process.env.NODE_ENV === 'production';

    // In non-production environments only, support direct raw secret if configured
    if (!secret && !isProduction && secretRef && secretRef.length >= 16 && !secretRef.startsWith('LENDER_') && !secretRef.includes('_SECRET')) {
      secret = secretRef;
    }

    // Development-only fallback credentials require explicit non-production configuration
    if (!secret && !isProduction) {
      secret = process.env.DEV_DEFAULT_WEBHOOK_SECRET;
    }

    if (!secret) {
      // Fail closed: Never process webhooks without a valid configured secret
      throw new UnauthorizedError(`Webhook secret is not configured for lender ${lenderCode}`);
    }

    const isSignatureValid = this.verifySignature(
      secret,
      rawPayload,
      signatureHeader,
      timestampHeader,
    );

    const payloadHash = createHash('sha256').update(rawPayload).digest('hex');

    let body: any;
    try {
      body = JSON.parse(rawPayload);
    } catch {
      throw new BadRequestError('Invalid webhook JSON body');
    }

    const eventId = String(body.eventId || body.id || `evt_${payloadHash.substring(0, 16)}`);
    const eventType = String(body.eventType || body.type || 'UNKNOWN');

    // Check de-duplication
    const existing = await this.stores.webhooks.findByEvent(lender.id, eventId);
    if (existing) {
      return {
        eventId,
        processed: existing.processingStatus === 'PROCESSED',
        duplicate: true,
        status: existing.processingStatus,
      };
    }

    // Record received event
    const recordedEvent = await this.stores.webhooks.recordReceived({
      lenderId: lender.id,
      lenderApplicationId: body.lenderApplicationId ?? null,
      eventId,
      eventType,
      signatureValid: isSignatureValid,
      processingStatus: isSignatureValid ? 'RECEIVED' : 'REJECTED_INVALID_SIGNATURE',
      payloadHash,
      safePayloadSummary: {
        eventType,
        lenderReference: body.lenderReference ?? body.externalReference,
        amountPaise: body.amountPaise,
      },
      errorCode: isSignatureValid ? null : 'INVALID_SIGNATURE',
      processedAt: null,
    });

    if (!isSignatureValid) {
      throw new UnauthorizedError('Invalid webhook signature or stale timestamp');
    }

    // Process event business effects
    await this.handleWebhookBusinessEffect(lender.id, body);

    await this.stores.webhooks.markProcessed(recordedEvent.id, 'PROCESSED');

    return {
      eventId,
      processed: true,
      duplicate: false,
      status: 'PROCESSED',
    };
  }

  private async handleWebhookBusinessEffect(lenderId: string, body: any): Promise<void> {
    const eventType = body.eventType || body.type;
    const applicationId = body.applicationId;
    const externalRef = body.externalReference || body.lenderReference;

    if (!applicationId && !externalRef) return;

    let app = applicationId ? await this.stores.applications.findById(applicationId) : null;
    let lenderApp: any = null;

    if (externalRef) {
      for (const la of (this.stores as any).lenderApplicationsMap?.values() ?? []) {
        if (la.lenderId === lenderId && la.externalReference === externalRef) {
          lenderApp = la;
          if (!app) app = await this.stores.applications.findById(la.applicationId);
          break;
        }
      }
    }

    if (!app) return;

    if (eventType === 'LOAN_DISBURSED' || eventType === 'DISBURSEMENT_SUCCESSFUL') {
      const amountPaise = body.amountPaise ? BigInt(body.amountPaise) : app.requestedAmountPaise;

      if (lenderApp) {
        await this.stores.disbursements.record({
          lenderApplicationId: lenderApp.id,
          state: 'DISBURSED',
          amountPaise,
          lenderReference: externalRef ?? null,
          lenderReportedAt: new Date(),
          source: 'LENDER',
        });
      }

      // Transition application to DISBURSED if in valid state
      if (app.status === 'CUSTOMER_ACCEPTED_OFFER' || app.status === 'LENDER_FINAL_CONFIRMATION') {
        if (app.status === 'CUSTOMER_ACCEPTED_OFFER') {
          assertTransition('CUSTOMER_ACCEPTED_OFFER', 'LENDER_FINAL_CONFIRMATION', { actor: 'SYSTEM' });
          app = await this.stores.applications.updateStatus({
            id: app.id,
            expectedVersion: app.version,
            toStatus: 'LENDER_FINAL_CONFIRMATION',
            actorType: 'SYSTEM',
          });
        }

        assertTransition('LENDER_FINAL_CONFIRMATION', 'DISBURSEMENT_PENDING', { actor: 'LENDER', lenderConfirmed: true });
        app = await this.stores.applications.updateStatus({
          id: app.id,
          expectedVersion: app.version,
          toStatus: 'DISBURSEMENT_PENDING',
          actorType: 'LENDER',
        });
      }

      if (app.status === 'DISBURSEMENT_PENDING') {
        assertTransition('DISBURSEMENT_PENDING', 'DISBURSED', { actor: 'LENDER', lenderConfirmed: true });
        app = await this.stores.applications.updateStatus({
          id: app.id,
          expectedVersion: app.version,
          toStatus: 'DISBURSED',
          actorType: 'LENDER',
          terminalAt: new Date(),
          reason: `Lender confirmed disbursement of ${amountPaise} paise`,
        });

        // Record confirmed transaction
        const transaction = await this.stores.transactions.create({
          merchantId: app.merchantId,
          applicationId: app.id,
          lenderApplicationId: lenderApp?.id ?? null,
          lenderId,
          type: 'LOAN_DISBURSEMENT',
          status: 'CONFIRMED',
          amountPaise,
          lenderTransactionRef: externalRef ?? null,
          lenderConfirmedAt: new Date(),
          reconciliationStatus: 'MATCHED',
          reconciledAt: new Date(),
        });

        // Accrue commission (1.5% platform commission)
        const commissionPaise = (amountPaise * 150n) / 10000n;
        await this.stores.commissions.accrue({
          merchantId: app.merchantId,
          applicationId: app.id,
          transactionId: transaction.id,
          entryType: 'ACCRUAL',
          amountPaise: commissionPaise,
          ruleCode: 'DEFAULT_STANDARD_1.5PCT',
          ruleSnapshot: { ratePercent: 1.5, calculatedFromPaise: amountPaise.toString() },
          reversesEntryId: null,
          note: 'Platform commission on confirmed disbursement',
        });
      }
    } else if (eventType === 'LOAN_DECLINED') {
      if (app.status === 'LENDER_PROCESSING' || app.status === 'LENDER_FINAL_CONFIRMATION') {
        assertTransition(app.status, 'DECLINED', { actor: 'LENDER', lenderConfirmed: true });
        await this.stores.applications.updateStatus({
          id: app.id,
          expectedVersion: app.version,
          toStatus: 'DECLINED',
          actorType: 'LENDER',
          terminalAt: new Date(),
          reason: body.declineReason ?? 'Lender declined loan via webhook',
        });
      }
    }
  }
}
