import { ConflictError, NotFoundError } from '../../common/errors';
import { assertTransition } from '../applications/application-state-machine';
import type {
  AppStores,
  AuditLogEntity,
  FinancingApplicationEntity,
  LenderConfigurationEntity,
  MerchantEntity,
} from '../persistence/stores';

export class AdminService {
  constructor(private readonly stores: AppStores) {}

  async verifyMerchant(merchantId: string, adminUserId: string): Promise<MerchantEntity> {
    const merchant = await this.stores.merchants.findById(merchantId);
    if (!merchant) throw new NotFoundError('Merchant not found');

    const updated = await this.stores.merchants.updateStatus(merchantId, 'VERIFIED');

    await this.stores.auditLogs.record({
      actorType: 'ADMIN_USER',
      actorUserId: adminUserId,
      merchantId,
      action: 'merchant.verified',
      entityType: 'Merchant',
      entityId: merchantId,
      requestId: null,
      metadata: { previousStatus: merchant.status },
    });

    return updated;
  }

  async suspendMerchant(
    merchantId: string,
    reason: string,
    adminUserId: string,
  ): Promise<MerchantEntity> {
    const merchant = await this.stores.merchants.findById(merchantId);
    if (!merchant) throw new NotFoundError('Merchant not found');

    const updated = await this.stores.merchants.updateStatus(merchantId, 'SUSPENDED', reason);

    await this.stores.auditLogs.record({
      actorType: 'ADMIN_USER',
      actorUserId: adminUserId,
      merchantId,
      action: 'merchant.suspended',
      entityType: 'Merchant',
      entityId: merchantId,
      requestId: null,
      metadata: { previousStatus: merchant.status, reason },
    });

    return updated;
  }

  async updateLenderConfig(
    lenderId: string,
    updates: Partial<LenderConfigurationEntity>,
    adminUserId: string,
  ): Promise<LenderConfigurationEntity> {
    const lender = await this.stores.lenders.findById(lenderId);
    if (!lender) throw new NotFoundError('Lender not found');

    const currentConfig = await this.stores.lenders.getConfig(lenderId);
    const saved = await this.stores.lenders.saveConfig({
      lenderId,
      enabled: updates.enabled ?? currentConfig?.enabled ?? false,
      priority: updates.priority ?? currentConfig?.priority ?? 100,
      minAmountPaise: updates.minAmountPaise !== undefined ? updates.minAmountPaise : (currentConfig?.minAmountPaise ?? null),
      maxAmountPaise: updates.maxAmountPaise !== undefined ? updates.maxAmountPaise : (currentConfig?.maxAmountPaise ?? null),
      supportedCategories: updates.supportedCategories ?? currentConfig?.supportedCategories ?? [],
      supportsDiscovery: updates.supportsDiscovery ?? currentConfig?.supportsDiscovery ?? false,
      fallbackOnDecline: updates.fallbackOnDecline ?? currentConfig?.fallbackOnDecline ?? true,
      requestTimeoutMs: updates.requestTimeoutMs ?? currentConfig?.requestTimeoutMs ?? 10000,
      maxSafeRetries: updates.maxSafeRetries ?? currentConfig?.maxSafeRetries ?? 2,
      routingRules: updates.routingRules ?? currentConfig?.routingRules ?? null,
      secretRef: updates.secretRef ?? currentConfig?.secretRef ?? null,
      updatedByUserId: adminUserId,
    });

    await this.stores.auditLogs.record({
      actorType: 'ADMIN_USER',
      actorUserId: adminUserId,
      merchantId: null,
      action: 'lender_config.updated',
      entityType: 'LenderConfiguration',
      entityId: lenderId,
      requestId: null,
      metadata: { lenderCode: lender.code, updates },
    });

    return saved;
  }

  async listAuditLogs(
    entityType?: string,
    entityId?: string,
    skip = 0,
    take = 50,
  ): Promise<{ items: AuditLogEntity[]; total: number }> {
    return this.stores.auditLogs.list(entityType, entityId, skip, take);
  }

  async resolveManualReview(params: {
    applicationId: string;
    decision: 'LENDER_PROCESSING' | 'DECLINED' | 'CANCELLED';
    reason: string;
    adminUserId: string;
  }): Promise<FinancingApplicationEntity> {
    const { applicationId, decision, reason, adminUserId } = params;

    const app = await this.stores.applications.findById(applicationId);
    if (!app) throw new NotFoundError('Application not found');
    if (app.status !== 'MANUAL_REVIEW') {
      throw new ConflictError(`Application is in ${app.status}, not in MANUAL_REVIEW`);
    }

    assertTransition(app.status, decision, {
      actor: 'ADMIN_USER',
      lenderConfirmed: decision === 'DECLINED',
    });

    const updated = await this.stores.applications.updateStatus({
      id: app.id,
      expectedVersion: app.version,
      toStatus: decision,
      actorType: 'ADMIN_USER',
      actorId: adminUserId,
      reason: `Manual review resolved by admin: ${reason}`,
      terminalAt: decision === 'DECLINED' || decision === 'CANCELLED' ? new Date() : undefined,
    });

    await this.stores.auditLogs.record({
      actorType: 'ADMIN_USER',
      actorUserId: adminUserId,
      merchantId: app.merchantId,
      action: `manual_review.${decision.toLowerCase()}`,
      entityType: 'FinancingApplication',
      entityId: app.id,
      requestId: null,
      metadata: { reason, previousStatus: app.status },
    });

    return updated;
  }
}

