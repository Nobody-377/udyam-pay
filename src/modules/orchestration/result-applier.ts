import { createHash } from 'node:crypto';
import { assertTransition } from '../applications/application-state-machine';
import { isTerminalStatus } from '../applications/application-status';
import type { SubmissionResult } from '../lenders/lender-adapter.interface';
import type {
  AppStores,
  FinancingApplicationEntity,
  LenderApplicationEntity,
  LenderEntity,
} from '../persistence/stores';

export interface ApplyResultParams {
  application: FinancingApplicationEntity;
  lenderApplication: LenderApplicationEntity;
  lender: LenderEntity;
  result: SubmissionResult;
  isFinalLenderInWaterfall: boolean;
}

export interface ApplyResultOutcome {
  application: FinancingApplicationEntity;
  lenderApplication: LenderApplicationEntity;
  appliedStatus: FinancingApplicationEntity['status'];
  duplicateOrStale: boolean;
}

export class ResultApplier {
  constructor(private readonly stores: AppStores) {}

  async apply(params: ApplyResultParams): Promise<ApplyResultOutcome> {
    const { application, lenderApplication, lender, result, isFinalLenderInWaterfall } = params;

    // Check if application is already in a terminal state or customer has already accepted an offer
    if (
      isTerminalStatus(application.status) ||
      application.status === 'CUSTOMER_ACCEPTED_OFFER' ||
      application.status === 'DISBURSED'
    ) {
      return {
        application,
        lenderApplication,
        appliedStatus: application.status,
        duplicateOrStale: true,
      };
    }

    // Compute payload hash for forensics (safely serialize BigInt paise values)
    const responsePayload = JSON.stringify(
      result.safeResponseSummary ?? result,
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
    );
    const responseHash = createHash('sha256').update(responsePayload).digest('hex');

    // Update the lender application attempt row
    const updatedLenderApp = await this.stores.lenderApplications.updateOutcome({
      id: lenderApplication.id,
      outcome: result.outcome,
      externalReference: result.externalReference,
      errorCode: result.errorCode,
      responseHash,
      safeResponseSummary: result.safeResponseSummary,
      latencyMs: result.latencyMs,
    });

    let targetStatus = application.status;
    let lenderConfirmed = false;
    let reason: string | undefined;

    switch (result.outcome) {
      case 'OFFERED': {
        // Save offers
        if (result.offers && result.offers.length > 0) {
          for (const offer of result.offers) {
            await this.stores.offers.create({
              applicationId: application.id,
              lenderApplicationId: lenderApplication.id,
              merchantId: application.merchantId,
              lenderId: lender.id,
              offerType: 'FIRM_OFFER',
              status: 'ACTIVE',
              lenderOfferReference: offer.lenderOfferReference,
              principalPaise: offer.principalPaise,
              downPaymentPaise: offer.downPaymentPaise ?? null,
              tenureMonths: offer.tenureMonths,
              interestRatePercent: offer.interestRatePercent,
              rateType: offer.rateType,
              aprPercent: offer.aprPercent,
              emiPaise: offer.emiPaise,
              processingFeePaise: offer.processingFeePaise ?? null,
              taxesPaise: offer.taxesPaise ?? null,
              otherChargesPaise: offer.otherChargesPaise ?? null,
              totalRepayablePaise: offer.totalRepayablePaise ?? null,
              repaymentSchedule: null,
              termsVersion: offer.termsVersion ?? null,
              termsUrl: offer.termsUrl ?? null,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
              isSimulated: lender.isSimulated,
            });
          }
        }
        targetStatus = 'OFFER_AVAILABLE';
        lenderConfirmed = true;
        reason = `Lender ${lender.code} provided ${result.offers?.length ?? 0} offer(s)`;
        break;
      }

      case 'DECLINED': {
        if (isFinalLenderInWaterfall) {
          targetStatus = 'DECLINED';
          lenderConfirmed = true;
          reason = `Application declined by all available lenders (final: ${lender.code})`;
        } else {
          // Do not transition application to DECLINED yet; fallback lender will be attempted
          return {
            application,
            lenderApplication: updatedLenderApp,
            appliedStatus: application.status,
            duplicateOrStale: false,
          };
        }
        break;
      }

      case 'ADDITIONAL_INFO_REQUIRED': {
        targetStatus = 'ADDITIONAL_INFORMATION_REQUIRED';
        lenderConfirmed = true;
        reason = `Lender ${lender.code} requested additional documentation`;
        break;
      }

      case 'PENDING': {
        // Asynchronous processing; stays in LENDER_PROCESSING
        return {
          application,
          lenderApplication: updatedLenderApp,
          appliedStatus: application.status,
          duplicateOrStale: false,
        };
      }

      case 'TIMEOUT':
      case 'UNAVAILABLE':
      case 'RATE_LIMITED':
      case 'MALFORMED_RESPONSE':
      default: {
        // Technical error is NOT a credit decline
        if (isFinalLenderInWaterfall) {
          targetStatus = 'TECHNICAL_FAILURE';
          lenderConfirmed = false;
          reason = `Lender ${lender.code} technical failure: ${result.errorCode ?? result.outcome}`;
        } else {
          // Fallback to next lender in waterfall
          return {
            application,
            lenderApplication: updatedLenderApp,
            appliedStatus: application.status,
            duplicateOrStale: false,
          };
        }
        break;
      }
    }

    if (targetStatus !== application.status) {
      assertTransition(application.status, targetStatus, {
        actor: 'SYSTEM',
        lenderConfirmed,
      });

      const updatedApp = await this.stores.applications.updateStatus({
        id: application.id,
        expectedVersion: application.version,
        toStatus: targetStatus,
        actorType: 'SYSTEM',
        reason,
        metadata: {
          lenderCode: lender.code,
          lenderApplicationId: lenderApplication.id,
          outcome: result.outcome,
        },
      });

      return {
        application: updatedApp,
        lenderApplication: updatedLenderApp,
        appliedStatus: targetStatus,
        duplicateOrStale: false,
      };
    }

    return {
      application,
      lenderApplication: updatedLenderApp,
      appliedStatus: application.status,
      duplicateOrStale: false,
    };
  }
}

