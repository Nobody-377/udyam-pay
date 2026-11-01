import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError } from '../../common/errors';
import { isTerminalStatus } from '../applications/application-status';
import type {
  AppStores,
  ApplicationStatusHistoryEntity,
  ApplicationStore,
  AuditLogEntity,
  AuditLogStore,
  CheckoutSessionEntity,
  CheckoutSessionStore,
  CommissionEntryEntity,
  CommissionStore,
  ConsentStore,
  CustomerConsentEntity,
  CustomerEntity,
  CustomerStore,
  DisbursementStatusEntity,
  DisbursementStore,
  FinancingApplicationEntity,
  FinancingOfferEntity,
  LenderApplicationEntity,
  LenderApplicationStore,
  LenderConfigurationEntity,
  LenderEntity,
  LenderStore,
  MerchantEntity,
  MerchantStore,
  OfferStatus,
  OfferStore,
  PurchaseEntity,
  PurchaseStore,
  RefreshSessionEntity,
  RefreshSessionStore,
  ShopEntity,
  ShopStore,
  TransactionEntity,
  TransactionStore,
  UserEntity,
  UserStore,
  WebhookEventEntity,
  WebhookProcessingStatus,
  WebhookStore,
} from './stores';

export class InMemoryStores implements AppStores {
  usersMap = new Map<string, UserEntity>();
  refreshSessionsMap = new Map<string, RefreshSessionEntity>();
  merchantsMap = new Map<string, MerchantEntity>();
  shopsMap = new Map<string, ShopEntity>();
  customersMap = new Map<string, CustomerEntity>();
  consentsMap = new Map<string, CustomerConsentEntity>();
  purchasesMap = new Map<string, PurchaseEntity>();
  checkoutSessionsMap = new Map<string, CheckoutSessionEntity>();
  lendersMap = new Map<string, LenderEntity>();
  lenderConfigsMap = new Map<string, LenderConfigurationEntity>();
  applicationsMap = new Map<string, FinancingApplicationEntity>();
  statusHistoryList: ApplicationStatusHistoryEntity[] = [];
  lenderApplicationsMap = new Map<string, LenderApplicationEntity>();
  offersMap = new Map<string, FinancingOfferEntity>();
  webhooksMap = new Map<string, WebhookEventEntity>();
  transactionsMap = new Map<string, TransactionEntity>();
  disbursementsList: DisbursementStatusEntity[] = [];
  commissionsList: CommissionEntryEntity[] = [];
  auditLogsList: AuditLogEntity[] = [];

  users: UserStore = {
    create: async (data) => {
      const email = data.email.toLowerCase();
      for (const u of this.usersMap.values()) {
        if (u.email === email) {
          throw new ConflictError(`User with email ${email} already exists`);
        }
      }
      const now = new Date();
      const entity: UserEntity = {
        ...data,
        email,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      this.usersMap.set(entity.id, entity);
      return { ...entity };
    },
    findById: async (id) => {
      const u = this.usersMap.get(id);
      return u ? { ...u } : null;
    },
    findByEmail: async (email) => {
      const lower = email.toLowerCase();
      for (const u of this.usersMap.values()) {
        if (u.email === lower) return { ...u };
      }
      return null;
    },
    incrementFailedLogin: async (id, lockUntil) => {
      const u = this.usersMap.get(id);
      if (u) {
        u.failedLoginCount += 1;
        if (lockUntil) u.lockedUntil = lockUntil;
        u.updatedAt = new Date();
      }
    },
    resetFailedLogin: async (id) => {
      const u = this.usersMap.get(id);
      if (u) {
        u.failedLoginCount = 0;
        u.lockedUntil = null;
        u.updatedAt = new Date();
      }
    },
    incrementTokenVersion: async (id) => {
      const u = this.usersMap.get(id);
      if (u) {
        u.tokenVersion += 1;
        u.updatedAt = new Date();
      }
    },
    updateLastLogin: async (id, at = new Date()) => {
      const u = this.usersMap.get(id);
      if (u) {
        u.lastLoginAt = at;
        u.updatedAt = new Date();
      }
    },
    listUsers: async (merchantId) => {
      const all = Array.from(this.usersMap.values());
      return merchantId ? all.filter((u) => u.merchantId === merchantId) : all;
    },
  };

  refreshSessions: RefreshSessionStore = {
    create: async (data) => {
      for (const s of this.refreshSessionsMap.values()) {
        if (s.tokenHash === data.tokenHash) {
          throw new ConflictError('Refresh session token hash collision');
        }
      }
      const entity: RefreshSessionEntity = {
        ...data,
        id: randomUUID(),
        createdAt: new Date(),
      };
      this.refreshSessionsMap.set(entity.id, entity);
      return { ...entity };
    },
    findByTokenHash: async (hash) => {
      for (const s of this.refreshSessionsMap.values()) {
        if (s.tokenHash === hash) return { ...s };
      }
      return null;
    },
    rotateSession: async (id, newSession) => {
      const old = this.refreshSessionsMap.get(id);
      if (!old) throw new NotFoundError('Refresh session not found');
      const replacementId = randomUUID();
      old.revokedAt = new Date();
      old.replacedById = replacementId;

      const created: RefreshSessionEntity = {
        ...newSession,
        id: replacementId,
        createdAt: new Date(),
      };
      this.refreshSessionsMap.set(created.id, created);
      return { ...created };
    },
    revokeFamily: async (familyId) => {
      const now = new Date();
      for (const s of this.refreshSessionsMap.values()) {
        if (s.familyId === familyId && !s.revokedAt) {
          s.revokedAt = now;
        }
      }
    },
    revokeUserSessions: async (userId) => {
      const now = new Date();
      for (const s of this.refreshSessionsMap.values()) {
        if (s.userId === userId && !s.revokedAt) {
          s.revokedAt = now;
        }
      }
    },
  };

  merchants: MerchantStore = {
    create: async (data) => {
      const now = new Date();
      const entity: MerchantEntity = {
        ...data,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      this.merchantsMap.set(entity.id, entity);
      return { ...entity };
    },
    findById: async (id) => {
      const m = this.merchantsMap.get(id);
      return m ? { ...m } : null;
    },
    list: async (status) => {
      const all = Array.from(this.merchantsMap.values());
      return status ? all.filter((m) => m.status === status) : all;
    },
    updateStatus: async (id, status, reason) => {
      const m = this.merchantsMap.get(id);
      if (!m) throw new NotFoundError('Merchant not found');
      m.status = status;
      m.updatedAt = new Date();
      if (status === 'VERIFIED') m.verifiedAt = new Date();
      if (status === 'SUSPENDED') {
        m.suspendedAt = new Date();
        m.suspensionReason = reason ?? null;
      }
      return { ...m };
    },
  };

  shops: ShopStore = {
    create: async (data) => {
      const now = new Date();
      const entity: ShopEntity = {
        ...data,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      this.shopsMap.set(entity.id, entity);
      return { ...entity };
    },
    findById: async (id) => {
      const s = this.shopsMap.get(id);
      return s ? { ...s } : null;
    },
    listByMerchant: async (merchantId) => {
      return Array.from(this.shopsMap.values()).filter((s) => s.merchantId === merchantId);
    },
  };

  customers: CustomerStore = {
    create: async (data) => {
      for (const c of this.customersMap.values()) {
        if (c.merchantId === data.merchantId && c.phone === data.phone) {
          throw new ConflictError('Customer with this phone number already exists for this merchant');
        }
      }
      const now = new Date();
      const entity: CustomerEntity = {
        ...data,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      this.customersMap.set(entity.id, entity);
      return { ...entity };
    },
    findById: async (id) => {
      const c = this.customersMap.get(id);
      return c ? { ...c } : null;
    },
    findByPhone: async (merchantId, phone) => {
      for (const c of this.customersMap.values()) {
        if (c.merchantId === merchantId && c.phone === phone) {
          return { ...c };
        }
      }
      return null;
    },
    anonymizeCustomer: async (id) => {
      const c = this.customersMap.get(id);
      if (c) {
        c.fullName = '[ANONYMIZED]';
        c.phone = `+9100000${c.id.substring(0, 5)}`;
        c.anonymizedAt = new Date();
        c.updatedAt = new Date();
      }
    },
  };

  consents: ConsentStore = {
    create: async (data) => {
      const entity: CustomerConsentEntity = {
        ...data,
        id: randomUUID(),
        createdAt: new Date(),
      };
      this.consentsMap.set(entity.id, entity);
      return { ...entity };
    },
    findActive: async (customerId, purpose) => {
      for (const c of this.consentsMap.values()) {
        if (c.customerId === customerId && c.purpose === purpose && !c.revokedAt) {
          return { ...c };
        }
      }
      return null;
    },
    revoke: async (id) => {
      const c = this.consentsMap.get(id);
      if (c) {
        c.revokedAt = new Date();
      }
    },
    listByCustomer: async (customerId) => {
      return Array.from(this.consentsMap.values()).filter((c) => c.customerId === customerId);
    },
  };

  purchases: PurchaseStore = {
    createIdempotent: async (data) => {
      for (const p of this.purchasesMap.values()) {
        if (p.merchantId === data.merchantId && p.idempotencyKey === data.idempotencyKey) {
          return { ...p };
        }
      }
      const now = new Date();
      const entity: PurchaseEntity = {
        ...data,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      this.purchasesMap.set(entity.id, entity);
      return { ...entity };
    },
    findById: async (id) => {
      const p = this.purchasesMap.get(id);
      return p ? { ...p } : null;
    },
    listByMerchant: async (merchantId, skip = 0, take = 20) => {
      const items = Array.from(this.purchasesMap.values())
        .filter((p) => p.merchantId === merchantId)
        .slice(skip, skip + take);
      const total = Array.from(this.purchasesMap.values()).filter((p) => p.merchantId === merchantId).length;
      return { items, total };
    },
  };

  checkoutSessions: CheckoutSessionStore = {
    create: async (data) => {
      for (const s of this.checkoutSessionsMap.values()) {
        if (s.tokenHash === data.tokenHash) {
          throw new ConflictError('Checkout session token hash collision');
        }
      }
      const entity: CheckoutSessionEntity = {
        ...data,
        id: randomUUID(),
        createdAt: new Date(),
      };
      this.checkoutSessionsMap.set(entity.id, entity);
      return { ...entity };
    },
    findByTokenHash: async (hash) => {
      for (const s of this.checkoutSessionsMap.values()) {
        if (s.tokenHash === hash) return { ...s };
      }
      return null;
    },
    findById: async (id) => {
      const s = this.checkoutSessionsMap.get(id);
      return s ? { ...s } : null;
    },
    markConsumed: async (id) => {
      const s = this.checkoutSessionsMap.get(id);
      if (s) {
        s.status = 'CONSUMED';
        s.consumedAt = new Date();
      }
    },
    markExpired: async (id) => {
      const s = this.checkoutSessionsMap.get(id);
      if (s) {
        s.status = 'EXPIRED';
      }
    },
    markRevoked: async (id) => {
      const s = this.checkoutSessionsMap.get(id);
      if (s) {
        s.status = 'REVOKED';
        s.revokedAt = new Date();
      }
    },
    findExpired: async (asOf = new Date(), limit = 100) => {
      const results: CheckoutSessionEntity[] = [];
      for (const s of this.checkoutSessionsMap.values()) {
        if (s.status === 'ACTIVE' && s.expiresAt < asOf) {
          results.push({ ...s });
          if (results.length >= limit) break;
        }
      }
      return results;
    },
  };

  lenders: LenderStore = {
    create: async (data) => {
      for (const l of this.lendersMap.values()) {
        if (l.code === data.code) throw new ConflictError('Lender code already exists');
      }
      const now = new Date();
      const entity: LenderEntity = {
        ...data,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      this.lendersMap.set(entity.id, entity);
      return { ...entity };
    },
    findById: async (id) => {
      const l = this.lendersMap.get(id);
      return l ? { ...l } : null;
    },
    findByCode: async (code) => {
      for (const l of this.lendersMap.values()) {
        if (l.code === code) return { ...l };
      }
      return null;
    },
    list: async (status) => {
      const all = Array.from(this.lendersMap.values());
      return status ? all.filter((l) => l.status === status) : all;
    },
    getConfig: async (lenderId) => {
      const cfg = this.lenderConfigsMap.get(lenderId);
      return cfg ? { ...cfg } : null;
    },
    saveConfig: async (data) => {
      const now = new Date();
      const existing = this.lenderConfigsMap.get(data.lenderId);
      const entity: LenderConfigurationEntity = {
        ...data,
        id: existing ? existing.id : randomUUID(),
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
      };
      this.lenderConfigsMap.set(data.lenderId, entity);
      return { ...entity };
    },
  };

  applications: ApplicationStore = {
    create: async (data) => {
      // Enforce duplicate idempotency key per merchant
      for (const a of this.applicationsMap.values()) {
        if (a.merchantId === data.merchantId && a.idempotencyKey === data.idempotencyKey) {
          return { ...a };
        }
      }
      // Enforce at most one active application per purchase
      for (const a of this.applicationsMap.values()) {
        if (a.purchaseId === data.purchaseId && !isTerminalStatus(a.status)) {
          throw new ConflictError(
            `An active application (${a.id}) already exists for purchase ${data.purchaseId}`,
          );
        }
      }
      const now = new Date();
      const entity: FinancingApplicationEntity = {
        ...data,
        id: randomUUID(),
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      this.applicationsMap.set(entity.id, entity);

      // Record initial history
      this.statusHistoryList.push({
        id: randomUUID(),
        applicationId: entity.id,
        fromStatus: null,
        toStatus: entity.status,
        actorType: 'SYSTEM',
        actorId: data.createdByUserId,
        reason: 'Application created',
        metadata: null,
        createdAt: now,
      });

      return { ...entity };
    },
    findById: async (id) => {
      const a = this.applicationsMap.get(id);
      return a ? { ...a } : null;
    },
    findByIdempotency: async (merchantId, key) => {
      for (const a of this.applicationsMap.values()) {
        if (a.merchantId === merchantId && a.idempotencyKey === key) {
          return { ...a };
        }
      }
      return null;
    },
    findActiveByPurchase: async (purchaseId) => {
      for (const a of this.applicationsMap.values()) {
        if (a.purchaseId === purchaseId && !isTerminalStatus(a.status)) {
          return { ...a };
        }
      }
      return null;
    },
    updateStatus: async ({
      id,
      expectedVersion,
      toStatus,
      actorType,
      actorId,
      reason,
      metadata,
      terminalAt,
      submittedAt,
    }) => {
      const app = this.applicationsMap.get(id);
      if (!app) throw new NotFoundError('Application not found');
      if (app.version !== expectedVersion) {
        throw new ConflictError(
          `Optimistic concurrency violation: application version is ${app.version}, expected ${expectedVersion}`,
        );
      }
      const fromStatus = app.status;
      app.status = toStatus;
      app.version += 1;
      app.updatedAt = new Date();
      if (submittedAt) app.submittedAt = submittedAt;
      if (terminalAt || isTerminalStatus(toStatus)) {
        app.terminalAt = terminalAt ?? new Date();
      }

      this.statusHistoryList.push({
        id: randomUUID(),
        applicationId: id,
        fromStatus,
        toStatus,
        actorType,
        actorId: actorId ?? null,
        reason: reason ?? null,
        metadata: metadata ?? null,
        createdAt: new Date(),
      });

      return { ...app };
    },
    getStatusHistory: async (applicationId) => {
      return this.statusHistoryList.filter((h) => h.applicationId === applicationId);
    },
    listByMerchant: async (merchantId, skip = 0, take = 20) => {
      const filtered = Array.from(this.applicationsMap.values()).filter(
        (a) => a.merchantId === merchantId,
      );
      return {
        items: filtered.slice(skip, skip + take),
        total: filtered.length,
      };
    },
    findExpired: async (asOf = new Date(), limit = 100) => {
      const expirableStatuses = new Set(['DRAFT', 'CUSTOMER_CONSENT_PENDING', 'OFFER_AVAILABLE']);
      const results: FinancingApplicationEntity[] = [];
      for (const a of this.applicationsMap.values()) {
        if (expirableStatuses.has(a.status) && a.expiresAt && a.expiresAt < asOf) {
          results.push({ ...a });
          if (results.length >= limit) break;
        }
      }
      return results;
    },
  };

  lenderApplications: LenderApplicationStore = {
    create: async (data) => {
      for (const la of this.lenderApplicationsMap.values()) {
        if (la.requestKey === data.requestKey) {
          throw new ConflictError('Lender application requestKey already exists');
        }
      }
      const now = new Date();
      const entity: LenderApplicationEntity = {
        ...data,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      this.lenderApplicationsMap.set(entity.id, entity);
      return { ...entity };
    },
    findById: async (id) => {
      const la = this.lenderApplicationsMap.get(id);
      return la ? { ...la } : null;
    },
    findByRequestKey: async (requestKey) => {
      for (const la of this.lenderApplicationsMap.values()) {
        if (la.requestKey === requestKey) return { ...la };
      }
      return null;
    },
    listByApplication: async (applicationId) => {
      return Array.from(this.lenderApplicationsMap.values()).filter(
        (la) => la.applicationId === applicationId,
      );
    },
    updateOutcome: async ({
      id,
      outcome,
      externalReference,
      errorCode,
      responseHash,
      safeResponseSummary,
      latencyMs,
      completedAt,
    }) => {
      const la = this.lenderApplicationsMap.get(id);
      if (!la) throw new NotFoundError('Lender application not found');
      la.outcome = outcome;
      if (externalReference) la.externalReference = externalReference;
      if (errorCode) la.errorCode = errorCode;
      if (responseHash) la.responseHash = responseHash;
      if (safeResponseSummary) la.safeResponseSummary = safeResponseSummary;
      if (latencyMs !== undefined) la.latencyMs = latencyMs;
      la.completedAt = completedAt ?? new Date();
      la.updatedAt = new Date();
      return { ...la };
    },
  };

  offers: OfferStore = {
    create: async (data) => {
      for (const o of this.offersMap.values()) {
        if (o.lenderId === data.lenderId && o.lenderOfferReference === data.lenderOfferReference) {
          throw new ConflictError('Offer with this reference already exists for this lender');
        }
      }
      const now = new Date();
      const entity: FinancingOfferEntity = {
        ...data,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      this.offersMap.set(entity.id, entity);
      return { ...entity };
    },
    findById: async (id) => {
      const o = this.offersMap.get(id);
      return o ? { ...o } : null;
    },
    listByApplication: async (applicationId, status) => {
      const all = Array.from(this.offersMap.values()).filter(
        (o) => o.applicationId === applicationId,
      );
      return status ? all.filter((o) => o.status === status) : all;
    },
    updateStatus: async (id, status: OfferStatus) => {
      const o = this.offersMap.get(id);
      if (o) {
        o.status = status;
        o.updatedAt = new Date();
      }
    },
    supersedeOthers: async (applicationId, acceptedOfferId) => {
      const now = new Date();
      for (const o of this.offersMap.values()) {
        if (o.applicationId === applicationId && o.id !== acceptedOfferId && o.status === 'ACTIVE') {
          o.status = 'SUPERSEDED';
          o.updatedAt = now;
        }
      }
    },
  };

  webhooks: WebhookStore = {
    recordReceived: async (data) => {
      for (const w of this.webhooksMap.values()) {
        if (w.lenderId === data.lenderId && w.eventId === data.eventId) {
          throw new ConflictError('Webhook event with this eventId already recorded for this lender');
        }
      }
      const entity: WebhookEventEntity = {
        ...data,
        id: randomUUID(),
        receivedAt: new Date(),
      };
      this.webhooksMap.set(entity.id, entity);
      return { ...entity };
    },
    findByEvent: async (lenderId, eventId) => {
      for (const w of this.webhooksMap.values()) {
        if (w.lenderId === lenderId && w.eventId === eventId) {
          return { ...w };
        }
      }
      return null;
    },
    markProcessed: async (id, status: WebhookProcessingStatus, errorCode) => {
      const w = this.webhooksMap.get(id);
      if (w) {
        w.processingStatus = status;
        if (errorCode) w.errorCode = errorCode;
        w.processedAt = new Date();
      }
    },
  };

  transactions: TransactionStore = {
    create: async (data) => {
      const now = new Date();
      const entity: TransactionEntity = {
        ...data,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      this.transactionsMap.set(entity.id, entity);
      return { ...entity };
    },
    findById: async (id) => {
      const t = this.transactionsMap.get(id);
      return t ? { ...t } : null;
    },
    findByApplication: async (applicationId) => {
      return Array.from(this.transactionsMap.values()).filter(
        (t) => t.applicationId === applicationId,
      );
    },
    confirmTransaction: async (id, lenderTransactionRef, confirmedAt = new Date()) => {
      const t = this.transactionsMap.get(id);
      if (!t) throw new NotFoundError('Transaction not found');
      t.status = 'CONFIRMED';
      t.lenderTransactionRef = lenderTransactionRef;
      t.lenderConfirmedAt = confirmedAt;
      t.updatedAt = new Date();
      return { ...t };
    },
  };

  disbursements: DisbursementStore = {
    record: async (data) => {
      const entity: DisbursementStatusEntity = {
        ...data,
        id: randomUUID(),
        recordedAt: new Date(),
      };
      this.disbursementsList.push(entity);
      return { ...entity };
    },
    listByLenderApp: async (lenderApplicationId) => {
      return this.disbursementsList.filter((d) => d.lenderApplicationId === lenderApplicationId);
    },
  };

  commissions: CommissionStore = {
    accrue: async (data) => {
      // Enforce unique accrual per transaction
      for (const c of this.commissionsList) {
        if (c.transactionId === data.transactionId && c.entryType === 'ACCRUAL') {
          throw new ConflictError(
            `Commission accrual already exists for transaction ${data.transactionId}`,
          );
        }
      }
      const entity: CommissionEntryEntity = {
        ...data,
        id: randomUUID(),
        createdAt: new Date(),
      };
      this.commissionsList.push(entity);
      return { ...entity };
    },
    reverse: async (data) => {
      // Enforce unique reversal per reversed entry
      if (data.reversesEntryId) {
        for (const c of this.commissionsList) {
          if (c.reversesEntryId === data.reversesEntryId && c.entryType === 'REVERSAL') {
            throw new ConflictError(
              `Commission entry ${data.reversesEntryId} has already been reversed`,
            );
          }
        }
      }
      const entity: CommissionEntryEntity = {
        ...data,
        id: randomUUID(),
        createdAt: new Date(),
      };
      this.commissionsList.push(entity);
      return { ...entity };
    },
    findByTransaction: async (transactionId) => {
      return this.commissionsList.filter((c) => c.transactionId === transactionId);
    },
    findById: async (id) => {
      const c = this.commissionsList.find((entry) => entry.id === id);
      return c ? { ...c } : null;
    },
    findReversal: async (accrualEntryId) => {
      const r = this.commissionsList.find(
        (entry) => entry.reversesEntryId === accrualEntryId && entry.entryType === 'REVERSAL',
      );
      return r ? { ...r } : null;
    },
    listByMerchant: async (merchantId, skip = 0, take = 50) => {
      const filtered = this.commissionsList.filter((c) => c.merchantId === merchantId);
      return {
        items: filtered.slice(skip, skip + take).map((c) => ({ ...c })),
        total: filtered.length,
      };
    },
    getMerchantTotals: async (merchantId) => {
      let totalAccruedPaise = 0n;
      let totalReversedPaise = 0n;
      for (const c of this.commissionsList) {
        if (c.merchantId === merchantId) {
          if (c.entryType === 'ACCRUAL') totalAccruedPaise += c.amountPaise;
          if (c.entryType === 'REVERSAL') totalReversedPaise += c.amountPaise;
        }
      }
      return {
        totalAccruedPaise,
        totalReversedPaise,
        netCommissionPaise: totalAccruedPaise - totalReversedPaise,
      };
    },
  };

  auditLogs: AuditLogStore = {
    record: async (data) => {
      const entity: AuditLogEntity = {
        ...data,
        id: randomUUID(),
        createdAt: new Date(),
      };
      this.auditLogsList.push(entity);
      return { ...entity };
    },
    list: async (entityType, entityId, skip = 0, take = 50) => {
      let filtered = this.auditLogsList;
      if (entityType) filtered = filtered.filter((l) => l.entityType === entityType);
      if (entityId) filtered = filtered.filter((l) => l.entityId === entityId);
      return {
        items: filtered.slice(skip, skip + take),
        total: filtered.length,
      };
    },
  };
}

