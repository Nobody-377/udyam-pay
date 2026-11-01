import { randomUUID } from 'node:crypto';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors';
import type { WaterfallOrchestrator } from '../orchestration/waterfall';
import type {
  ActorType,
  AppStores,
  FinancingApplicationEntity,
  FinancingOfferEntity,
  RoutingMode,
} from '../persistence/stores';
import { assertTransition } from './application-state-machine';

export interface CreateApplicationParams {
  merchantId: string;
  shopId: string;
  purchaseId: string;
  customerId: string;
  requestedAmountPaise: bigint;
  downPaymentPaise?: bigint;
  requestedTenureMonths?: number | null;
  routingMode?: RoutingMode;
  idempotencyKey?: string;
  createdByUserId?: string | null;
}

export interface ApplicationWithDetails {
  application: FinancingApplicationEntity;
  offers: FinancingOfferEntity[];
  purchase: {
    id: string;
    productCategory: string;
    productDescription: string | null;
    amountPaise: bigint;
  };
  customer: {
    id: string;
    fullName: string;
    phone: string;
  };
}

export class ApplicationService {
  constructor(
    private readonly stores: AppStores,
    private readonly waterfall?: WaterfallOrchestrator,
  ) {}

  async createApplication(params: CreateApplicationParams): Promise<FinancingApplicationEntity> {
    const {
      merchantId,
      shopId,
      purchaseId,
      customerId,
      requestedAmountPaise,
      downPaymentPaise = 0n,
      requestedTenureMonths = null,
      routingMode = 'SEQUENTIAL',
      idempotencyKey = `app_${randomUUID()}`,
      createdByUserId = null,
    } = params;

    // Verify purchase
    const purchase = await this.stores.purchases.findById(purchaseId);
    if (!purchase) {
      throw new NotFoundError('Purchase not found');
    }
    if (purchase.merchantId !== merchantId) {
      throw new ForbiddenError('Purchase does not belong to this merchant');
    }

    // Verify shop
    const shop = await this.stores.shops.findById(shopId);
    if (!shop || shop.merchantId !== merchantId) {
      throw new ForbiddenError('Shop does not belong to this merchant');
    }

    // Verify customer
    const customer = await this.stores.customers.findById(customerId);
    if (!customer || customer.merchantId !== merchantId) {
      throw new ForbiddenError('Customer does not belong to this merchant');
    }

    if (requestedAmountPaise <= 0n) {
      throw new ConflictError('Requested amount must be positive');
    }
    if (requestedAmountPaise > purchase.amountPaise) {
      throw new ConflictError('Requested amount cannot exceed purchase amount');
    }

    // Check idempotency
    const existing = await this.stores.applications.findByIdempotency(merchantId, idempotencyKey);
    if (existing) {
      return existing;
    }

    // Enforce at most one active application per purchase
    const activeApp = await this.stores.applications.findActiveByPurchase(purchaseId);
    if (activeApp) {
      throw new ConflictError(
        `Purchase ${purchaseId} already has an active financing application (${activeApp.id})`,
      );
    }

    return this.stores.applications.create({
      merchantId,
      shopId,
      purchaseId,
      customerId,
      createdByUserId,
      status: 'CUSTOMER_CONSENT_PENDING',
      routingMode,
      requestedAmountPaise,
      downPaymentPaise,
      requestedTenureMonths,
      idempotencyKey,
      submittedAt: null,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      terminalAt: null,
    });
  }

  async submitApplication(params: {
    applicationId: string;
    merchantId?: string;
    actor: ActorType;
    actorId?: string;
  }): Promise<FinancingApplicationEntity> {
    const { applicationId, merchantId, actor, actorId } = params;
    const app = await this.stores.applications.findById(applicationId);
    if (!app) {
      throw new NotFoundError('Application not found');
    }
    if (merchantId && app.merchantId !== merchantId) {
      throw new ForbiddenError('Application does not belong to this merchant');
    }

    // Validate customer consent exists
    const consent = await this.stores.consents.findActive(
      app.customerId,
      'FINANCING_APPLICATION_PROCESSING',
    );
    if (!consent) {
      throw new ConflictError(
        'Cannot submit application without active customer consent for FINANCING_APPLICATION_PROCESSING',
      );
    }

    assertTransition(app.status, 'SUBMITTED', { actor });

    const submittedApp = await this.stores.applications.updateStatus({
      id: app.id,
      expectedVersion: app.version,
      toStatus: 'SUBMITTED',
      actorType: actor,
      actorId,
      submittedAt: new Date(),
      reason: 'Application submitted for lender evaluation',
    });

    // If waterfall orchestrator is wired, trigger evaluation
    if (this.waterfall) {
      return this.waterfall.execute(submittedApp.id);
    }

    return submittedApp;
  }

  async cancelApplication(params: {
    applicationId: string;
    merchantId?: string;
    actor: ActorType;
    actorId?: string;
    reason?: string;
  }): Promise<FinancingApplicationEntity> {
    const { applicationId, merchantId, actor, actorId, reason = 'Cancelled by user' } = params;
    const app = await this.stores.applications.findById(applicationId);
    if (!app) {
      throw new NotFoundError('Application not found');
    }
    if (merchantId && app.merchantId !== merchantId) {
      throw new ForbiddenError('Application does not belong to this merchant');
    }

    assertTransition(app.status, 'CANCELLED', { actor });

    return this.stores.applications.updateStatus({
      id: app.id,
      expectedVersion: app.version,
      toStatus: 'CANCELLED',
      actorType: actor,
      actorId,
      reason,
      terminalAt: new Date(),
    });
  }

  async getApplication(
    applicationId: string,
    merchantId?: string,
  ): Promise<ApplicationWithDetails> {
    const app = await this.stores.applications.findById(applicationId);
    if (!app) throw new NotFoundError('Application not found');
    if (merchantId && app.merchantId !== merchantId) {
      throw new ForbiddenError('Access denied: merchant mismatch');
    }

    const purchase = await this.stores.purchases.findById(app.purchaseId);
    if (!purchase) throw new NotFoundError('Associated purchase not found');

    const customer = await this.stores.customers.findById(app.customerId);
    if (!customer) throw new NotFoundError('Associated customer not found');

    const offers = await this.stores.offers.listByApplication(app.id);

    return {
      application: app,
      offers,
      purchase: {
        id: purchase.id,
        productCategory: purchase.productCategory,
        productDescription: purchase.productDescription,
        amountPaise: purchase.amountPaise,
      },
      customer: {
        id: customer.id,
        fullName: customer.fullName,
        phone: customer.phone,
      },
    };
  }

  async getApplicationHistory(applicationId: string, merchantId?: string) {
    const app = await this.stores.applications.findById(applicationId);
    if (!app) throw new NotFoundError('Application not found');
    if (merchantId && app.merchantId !== merchantId) {
      throw new ForbiddenError('Access denied');
    }
    return this.stores.applications.getStatusHistory(applicationId);
  }

  async listApplications(merchantId: string, skip = 0, take = 20) {
    return this.stores.applications.listByMerchant(merchantId, skip, take);
  }
}

