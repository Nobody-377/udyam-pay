import type { PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors';
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
  WebhookStore,
} from './stores';

export class PrismaStore implements AppStores {
  constructor(private readonly prisma: PrismaClient) {}

  users: UserStore = {
    create: async (data) => {
      try {
        return (await this.prisma.user.create({
          data: {
            email: data.email.toLowerCase(),
            passwordHash: data.passwordHash,
            role: data.role as any,
            status: data.status as any,
            merchantId: data.merchantId,
            tokenVersion: data.tokenVersion,
            failedLoginCount: data.failedLoginCount,
            lockedUntil: data.lockedUntil,
            lastLoginAt: data.lastLoginAt,
          },
        })) as UserEntity;
      } catch (err: any) {
        if (err?.code === 'P2002') {
          throw new ConflictError(`User with email ${data.email} already exists`);
        }
        throw err;
      }
    },
    findById: async (id) => {
      const u = await this.prisma.user.findUnique({ where: { id } });
      return u as UserEntity | null;
    },
    findByEmail: async (email) => {
      const u = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      return u as UserEntity | null;
    },
    incrementFailedLogin: async (id, lockUntil) => {
      await this.prisma.user.update({
        where: { id },
        data: {
          failedLoginCount: { increment: 1 },
          ...(lockUntil ? { lockedUntil: lockUntil } : {}),
        },
      });
    },
    resetFailedLogin: async (id) => {
      await this.prisma.user.update({
        where: { id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    },
    incrementTokenVersion: async (id) => {
      await this.prisma.user.update({
        where: { id },
        data: { tokenVersion: { increment: 1 } },
      });
    },
    updateLastLogin: async (id, at = new Date()) => {
      await this.prisma.user.update({
        where: { id },
        data: { lastLoginAt: at },
      });
    },
    listUsers: async (merchantId) => {
      return (await this.prisma.user.findMany({
        where: merchantId ? { merchantId } : undefined,
      })) as UserEntity[];
    },
  };

  refreshSessions: RefreshSessionStore = {
    create: async (data) => {
      return (await this.prisma.refreshSession.create({
        data: {
          userId: data.userId,
          familyId: data.familyId,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          revokedAt: data.revokedAt,
          replacedById: data.replacedById,
          userAgent: data.userAgent,
        },
      })) as RefreshSessionEntity;
    },
    findByTokenHash: async (tokenHash) => {
      const s = await this.prisma.refreshSession.findUnique({ where: { tokenHash } });
      return s as RefreshSessionEntity | null;
    },
    rotateSession: async (id, newSession) => {
      return await this.prisma.$transaction(async (tx) => {
        const replacement = await tx.refreshSession.create({
          data: {
            userId: newSession.userId,
            familyId: newSession.familyId,
            tokenHash: newSession.tokenHash,
            expiresAt: newSession.expiresAt,
            revokedAt: null,
            replacedById: null,
            userAgent: newSession.userAgent,
          },
        });
        await tx.refreshSession.update({
          where: { id },
          data: { revokedAt: new Date(), replacedById: replacement.id },
        });
        return replacement as RefreshSessionEntity;
      });
    },
    revokeFamily: async (familyId) => {
      await this.prisma.refreshSession.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
    revokeUserSessions: async (userId) => {
      await this.prisma.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
  };

  merchants: MerchantStore = {
    create: async (data) => {
      return (await this.prisma.merchant.create({
        data: {
          legalName: data.legalName,
          tradeName: data.tradeName,
          status: data.status as any,
          verifiedAt: data.verifiedAt,
          suspendedAt: data.suspendedAt,
          suspensionReason: data.suspensionReason,
        },
      })) as MerchantEntity;
    },
    findById: async (id) => {
      const m = await this.prisma.merchant.findUnique({ where: { id } });
      return m as MerchantEntity | null;
    },
    list: async (status) => {
      return (await this.prisma.merchant.findMany({
        where: status ? { status: status as any } : undefined,
      })) as MerchantEntity[];
    },
    updateStatus: async (id, status, reason) => {
      return (await this.prisma.merchant.update({
        where: { id },
        data: {
          status: status as any,
          ...(status === 'VERIFIED' ? { verifiedAt: new Date() } : {}),
          ...(status === 'SUSPENDED' ? { suspendedAt: new Date(), suspensionReason: reason } : {}),
        },
      })) as MerchantEntity;
    },
  };

  shops: ShopStore = {
    create: async (data) => {
      return (await this.prisma.shop.create({
        data: {
          merchantId: data.merchantId,
          name: data.name,
          city: data.city,
          state: data.state,
          status: data.status as any,
        },
      })) as ShopEntity;
    },
    findById: async (id) => {
      const s = await this.prisma.shop.findUnique({ where: { id } });
      return s as ShopEntity | null;
    },
    listByMerchant: async (merchantId) => {
      return (await this.prisma.shop.findMany({
        where: { merchantId },
      })) as ShopEntity[];
    },
  };

  customers: CustomerStore = {
    create: async (data) => {
      try {
        return (await this.prisma.customer.create({
          data: {
            merchantId: data.merchantId,
            fullName: data.fullName,
            phone: data.phone,
            retentionExpiresAt: data.retentionExpiresAt,
            anonymizedAt: data.anonymizedAt,
          },
        })) as CustomerEntity;
      } catch (err: any) {
        if (err?.code === 'P2002') {
          throw new ConflictError('Customer with this phone number already exists for this merchant');
        }
        throw err;
      }
    },
    findById: async (id) => {
      const c = await this.prisma.customer.findUnique({ where: { id } });
      return c as CustomerEntity | null;
    },
    findByPhone: async (merchantId, phone) => {
      const c = await this.prisma.customer.findUnique({
        where: { merchantId_phone: { merchantId, phone } },
      });
      return c as CustomerEntity | null;
    },
    anonymizeCustomer: async (id) => {
      await this.prisma.customer.update({
        where: { id },
        data: {
          fullName: '[ANONYMIZED]',
          phone: `+9100000${id.substring(0, 5)}`,
          anonymizedAt: new Date(),
        },
      });
    },
  };

  consents: ConsentStore = {
    create: async (data) => {
      return (await this.prisma.customerConsent.create({
        data: {
          merchantId: data.merchantId,
          customerId: data.customerId,
          purpose: data.purpose as any,
          noticeVersion: data.noticeVersion,
          captureMethod: data.captureMethod as any,
          grantedAt: data.grantedAt,
          revokedAt: data.revokedAt,
        },
      })) as CustomerConsentEntity;
    },
    findActive: async (customerId, purpose) => {
      const c = await this.prisma.customerConsent.findFirst({
        where: { customerId, purpose: purpose as any, revokedAt: null },
      });
      return c as CustomerConsentEntity | null;
    },
    revoke: async (id) => {
      await this.prisma.customerConsent.update({
        where: { id },
        data: { revokedAt: new Date() },
      });
    },
    listByCustomer: async (customerId) => {
      return (await this.prisma.customerConsent.findMany({
        where: { customerId },
      })) as CustomerConsentEntity[];
    },
  };

  purchases: PurchaseStore = {
    createIdempotent: async (data) => {
      try {
        return (await this.prisma.purchase.upsert({
          where: {
            merchantId_idempotencyKey: {
              merchantId: data.merchantId,
              idempotencyKey: data.idempotencyKey,
            },
          },
          update: {},
          create: {
            merchantId: data.merchantId,
            shopId: data.shopId,
            customerId: data.customerId,
            productCategory: data.productCategory as any,
            productDescription: data.productDescription,
            amountPaise: data.amountPaise,
            currency: data.currency,
            idempotencyKey: data.idempotencyKey,
          },
        })) as PurchaseEntity;
      } catch (err: any) {
        if (err?.code === 'P2002') {
          const existing = await this.prisma.purchase.findUnique({
            where: {
              merchantId_idempotencyKey: {
                merchantId: data.merchantId,
                idempotencyKey: data.idempotencyKey,
              },
            },
          });
          if (existing) return existing as PurchaseEntity;
        }
        throw err;
      }
    },
    findById: async (id) => {
      const p = await this.prisma.purchase.findUnique({ where: { id } });
      return p as PurchaseEntity | null;
    },
    listByMerchant: async (merchantId, skip = 0, take = 20) => {
      const [items, total] = await Promise.all([
        this.prisma.purchase.findMany({
          where: { merchantId },
          skip,
          take,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.purchase.count({ where: { merchantId } }),
      ]);
      return { items: items as PurchaseEntity[], total };
    },
  };

  checkoutSessions: CheckoutSessionStore = {
    create: async (data) => {
      try {
        return (await this.prisma.checkoutSession.create({
          data: {
            merchantId: data.merchantId,
            shopId: data.shopId,
            purchaseId: data.purchaseId,
            createdByUserId: data.createdByUserId,
            tokenHash: data.tokenHash,
            status: data.status as any,
            expiresAt: data.expiresAt,
            consumedAt: data.consumedAt,
            revokedAt: data.revokedAt,
          },
        })) as CheckoutSessionEntity;
      } catch (err: any) {
        if (err?.code === 'P2002') throw new ConflictError('Checkout session token hash collision');
        throw err;
      }
    },
    findByTokenHash: async (tokenHash) => {
      const s = await this.prisma.checkoutSession.findUnique({ where: { tokenHash } });
      return s as CheckoutSessionEntity | null;
    },
    findById: async (id) => {
      const s = await this.prisma.checkoutSession.findUnique({ where: { id } });
      return s as CheckoutSessionEntity | null;
    },
    markConsumed: async (id) => {
      await this.prisma.checkoutSession.update({
        where: { id },
        data: { status: 'CONSUMED', consumedAt: new Date() },
      });
    },
    markExpired: async (id) => {
      await this.prisma.checkoutSession.update({
        where: { id },
        data: { status: 'EXPIRED' },
      });
    },
    markRevoked: async (id) => {
      await this.prisma.checkoutSession.update({
        where: { id },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
    },
    findExpired: async (asOf = new Date(), limit = 100) => {
      return (await this.prisma.checkoutSession.findMany({
        where: { status: 'ACTIVE', expiresAt: { lt: asOf } },
        take: limit,
        orderBy: { expiresAt: 'asc' },
      })) as CheckoutSessionEntity[];
    },
  };

  lenders: LenderStore = {
    create: async (data) => {
      return (await this.prisma.lender.create({
        data: {
          code: data.code,
          displayName: data.displayName,
          type: data.type as any,
          isSimulated: data.isSimulated,
          status: data.status as any,
        },
      })) as LenderEntity;
    },
    findById: async (id) => {
      const l = await this.prisma.lender.findUnique({ where: { id } });
      return l as LenderEntity | null;
    },
    findByCode: async (code) => {
      const l = await this.prisma.lender.findUnique({ where: { code } });
      return l as LenderEntity | null;
    },
    list: async (status) => {
      return (await this.prisma.lender.findMany({
        where: status ? { status: status as any } : undefined,
      })) as LenderEntity[];
    },
    getConfig: async (lenderId) => {
      const c = await this.prisma.lenderConfiguration.findUnique({ where: { lenderId } });
      return c as LenderConfigurationEntity | null;
    },
    saveConfig: async (data) => {
      return (await this.prisma.lenderConfiguration.upsert({
        where: { lenderId: data.lenderId },
        update: {
          enabled: data.enabled,
          priority: data.priority,
          minAmountPaise: data.minAmountPaise,
          maxAmountPaise: data.maxAmountPaise,
          supportedCategories: data.supportedCategories as any,
          supportsDiscovery: data.supportsDiscovery,
          fallbackOnDecline: data.fallbackOnDecline,
          requestTimeoutMs: data.requestTimeoutMs,
          maxSafeRetries: data.maxSafeRetries,
          routingRules: data.routingRules as any,
          secretRef: data.secretRef,
          updatedByUserId: data.updatedByUserId,
        },
        create: {
          lenderId: data.lenderId,
          enabled: data.enabled,
          priority: data.priority,
          minAmountPaise: data.minAmountPaise,
          maxAmountPaise: data.maxAmountPaise,
          supportedCategories: data.supportedCategories as any,
          supportsDiscovery: data.supportsDiscovery,
          fallbackOnDecline: data.fallbackOnDecline,
          requestTimeoutMs: data.requestTimeoutMs,
          maxSafeRetries: data.maxSafeRetries,
          routingRules: data.routingRules as any,
          secretRef: data.secretRef,
          updatedByUserId: data.updatedByUserId,
        },
      })) as LenderConfigurationEntity;
    },
  };

  applications: ApplicationStore = {
    create: async (data) => {
      return await this.prisma.$transaction(async (tx) => {
        // Enforce at most one active application per purchase
        const active = await tx.financingApplication.findFirst({
          where: {
            purchaseId: data.purchaseId,
            status: { notIn: ['DECLINED', 'DISBURSED', 'CANCELLED', 'EXPIRED'] },
          },
        });
        if (active) {
          throw new ConflictError(
            `Purchase ${data.purchaseId} already has an active financing application (${active.id})`,
          );
        }

        const app = await tx.financingApplication.create({
          data: {
            merchantId: data.merchantId,
            shopId: data.shopId,
            purchaseId: data.purchaseId,
            customerId: data.customerId,
            createdByUserId: data.createdByUserId,
            status: data.status as any,
            routingMode: data.routingMode as any,
            requestedAmountPaise: data.requestedAmountPaise,
            downPaymentPaise: data.downPaymentPaise,
            requestedTenureMonths: data.requestedTenureMonths,
            idempotencyKey: data.idempotencyKey,
            version: 0,
            submittedAt: data.submittedAt,
            expiresAt: data.expiresAt,
            terminalAt: data.terminalAt,
          },
        });

        await tx.applicationStatusHistory.create({
          data: {
            applicationId: app.id,
            fromStatus: null,
            toStatus: app.status,
            actorType: 'SYSTEM',
            actorId: data.createdByUserId,
            reason: 'Application created',
          },
        });

        return app as FinancingApplicationEntity;
      });
    },
    findById: async (id) => {
      const a = await this.prisma.financingApplication.findUnique({ where: { id } });
      return a as FinancingApplicationEntity | null;
    },
    findByIdempotency: async (merchantId, key) => {
      const a = await this.prisma.financingApplication.findUnique({
        where: { merchantId_idempotencyKey: { merchantId, idempotencyKey: key } },
      });
      return a as FinancingApplicationEntity | null;
    },
    findActiveByPurchase: async (purchaseId) => {
      const a = await this.prisma.financingApplication.findFirst({
        where: {
          purchaseId,
          status: { notIn: ['DECLINED', 'DISBURSED', 'CANCELLED', 'EXPIRED'] },
        },
      });
      return a as FinancingApplicationEntity | null;
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
      return await this.prisma.$transaction(async (tx) => {
        const app = await tx.financingApplication.findUnique({ where: { id } });
        if (!app) throw new NotFoundError('Application not found');
        if (app.version !== expectedVersion) {
          throw new ConflictError(
            `Optimistic concurrency violation: application version is ${app.version}, expected ${expectedVersion}`,
          );
        }

        const updated = await tx.financingApplication.update({
          where: { id },
          data: {
            status: toStatus as any,
            version: { increment: 1 },
            ...(submittedAt ? { submittedAt } : {}),
            ...(terminalAt ? { terminalAt } : {}),
          },
        });

        await tx.applicationStatusHistory.create({
          data: {
            applicationId: id,
            fromStatus: app.status,
            toStatus: toStatus as any,
            actorType: actorType as any,
            actorId: actorId ?? null,
            reason: reason ?? null,
            metadata: metadata as any,
          },
        });

        return updated as FinancingApplicationEntity;
      });
    },
    getStatusHistory: async (applicationId) => {
      return (await this.prisma.applicationStatusHistory.findMany({
        where: { applicationId },
        orderBy: { createdAt: 'asc' },
      })) as ApplicationStatusHistoryEntity[];
    },
    listByMerchant: async (merchantId, skip = 0, take = 20) => {
      const [items, total] = await Promise.all([
        this.prisma.financingApplication.findMany({
          where: { merchantId },
          skip,
          take,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.financingApplication.count({ where: { merchantId } }),
      ]);
      return { items: items as FinancingApplicationEntity[], total };
    },
    findExpired: async (asOf = new Date(), limit = 100) => {
      return (await this.prisma.financingApplication.findMany({
        where: {
          status: { in: ['DRAFT', 'CUSTOMER_CONSENT_PENDING', 'OFFER_AVAILABLE'] },
          expiresAt: { not: null, lt: asOf },
        },
        take: limit,
        orderBy: { expiresAt: 'asc' },
      })) as FinancingApplicationEntity[];
    },
  };

  lenderApplications: LenderApplicationStore = {
    create: async (data) => {
      return (await this.prisma.lenderApplication.create({
        data: {
          applicationId: data.applicationId,
          merchantId: data.merchantId,
          lenderId: data.lenderId,
          attemptNo: data.attemptNo,
          requestKey: data.requestKey,
          externalReference: data.externalReference,
          outcome: data.outcome as any,
          errorCode: data.errorCode,
          responseHash: data.responseHash,
          safeResponseSummary: data.safeResponseSummary as any,
          reconcileAttempts: data.reconcileAttempts,
          startedAt: data.startedAt,
          completedAt: data.completedAt,
          latencyMs: data.latencyMs,
        },
      })) as LenderApplicationEntity;
    },
    findById: async (id) => {
      const la = await this.prisma.lenderApplication.findUnique({ where: { id } });
      return la as LenderApplicationEntity | null;
    },
    findByRequestKey: async (requestKey) => {
      const la = await this.prisma.lenderApplication.findUnique({ where: { requestKey } });
      return la as LenderApplicationEntity | null;
    },
    listByApplication: async (applicationId) => {
      return (await this.prisma.lenderApplication.findMany({
        where: { applicationId },
        orderBy: { attemptNo: 'asc' },
      })) as LenderApplicationEntity[];
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
      return (await this.prisma.lenderApplication.update({
        where: { id },
        data: {
          outcome: outcome as any,
          ...(externalReference ? { externalReference } : {}),
          ...(errorCode ? { errorCode } : {}),
          ...(responseHash ? { responseHash } : {}),
          ...(safeResponseSummary ? { safeResponseSummary: safeResponseSummary as any } : {}),
          ...(latencyMs !== undefined ? { latencyMs } : {}),
          completedAt: completedAt ?? new Date(),
        },
      })) as LenderApplicationEntity;
    },
  };

  offers: OfferStore = {
    create: async (data) => {
      return (await this.prisma.financingOffer.create({
        data: {
          applicationId: data.applicationId,
          lenderApplicationId: data.lenderApplicationId,
          merchantId: data.merchantId,
          lenderId: data.lenderId,
          offerType: data.offerType as any,
          status: data.status as any,
          lenderOfferReference: data.lenderOfferReference,
          principalPaise: data.principalPaise,
          downPaymentPaise: data.downPaymentPaise,
          tenureMonths: data.tenureMonths,
          interestRatePercent: data.interestRatePercent ? Number(data.interestRatePercent) : null,
          rateType: data.rateType as any,
          aprPercent: data.aprPercent ? Number(data.aprPercent) : null,
          emiPaise: data.emiPaise,
          processingFeePaise: data.processingFeePaise,
          taxesPaise: data.taxesPaise,
          otherChargesPaise: data.otherChargesPaise,
          totalRepayablePaise: data.totalRepayablePaise,
          repaymentSchedule: data.repaymentSchedule as any,
          termsVersion: data.termsVersion,
          termsUrl: data.termsUrl,
          expiresAt: data.expiresAt,
          isSimulated: data.isSimulated,
        },
      })) as FinancingOfferEntity;
    },
    findById: async (id) => {
      const o = await this.prisma.financingOffer.findUnique({ where: { id } });
      return o as FinancingOfferEntity | null;
    },
    listByApplication: async (applicationId, status) => {
      return (await this.prisma.financingOffer.findMany({
        where: { applicationId, ...(status ? { status: status as any } : {}) },
      })) as FinancingOfferEntity[];
    },
    updateStatus: async (id, status) => {
      await this.prisma.financingOffer.update({
        where: { id },
        data: { status: status as any },
      });
    },
    supersedeOthers: async (applicationId, acceptedOfferId) => {
      await this.prisma.financingOffer.updateMany({
        where: {
          applicationId,
          id: { not: acceptedOfferId },
          status: 'ACTIVE',
        },
        data: { status: 'SUPERSEDED' },
      });
    },
  };

  webhooks: WebhookStore = {
    recordReceived: async (data) => {
      try {
        return (await this.prisma.webhookEvent.create({
          data: {
            lenderId: data.lenderId,
            lenderApplicationId: data.lenderApplicationId,
            eventId: data.eventId,
            eventType: data.eventType,
            signatureValid: data.signatureValid,
            processingStatus: data.processingStatus as any,
            payloadHash: data.payloadHash,
            safePayloadSummary: data.safePayloadSummary as any,
            errorCode: data.errorCode,
          },
        })) as WebhookEventEntity;
      } catch (err: any) {
        if (err?.code === 'P2002') {
          throw new ConflictError('Webhook event with this eventId already exists for this lender');
        }
        throw err;
      }
    },
    findByEvent: async (lenderId, eventId) => {
      const w = await this.prisma.webhookEvent.findUnique({
        where: { lenderId_eventId: { lenderId, eventId } },
      });
      return w as WebhookEventEntity | null;
    },
    markProcessed: async (id, status, errorCode) => {
      await this.prisma.webhookEvent.update({
        where: { id },
        data: {
          processingStatus: status as any,
          ...(errorCode ? { errorCode } : {}),
          processedAt: new Date(),
        },
      });
    },
  };

  transactions: TransactionStore = {
    create: async (data) => {
      return (await this.prisma.transaction.create({
        data: {
          merchantId: data.merchantId,
          applicationId: data.applicationId,
          lenderApplicationId: data.lenderApplicationId,
          lenderId: data.lenderId,
          type: data.type as any,
          status: data.status as any,
          amountPaise: data.amountPaise,
          lenderTransactionRef: data.lenderTransactionRef,
          lenderConfirmedAt: data.lenderConfirmedAt,
          reconciliationStatus: data.reconciliationStatus as any,
          reconciledAt: data.reconciledAt,
        },
      })) as TransactionEntity;
    },
    findById: async (id) => {
      const t = await this.prisma.transaction.findUnique({ where: { id } });
      return t as TransactionEntity | null;
    },
    findByApplication: async (applicationId) => {
      return (await this.prisma.transaction.findMany({
        where: { applicationId },
      })) as TransactionEntity[];
    },
    confirmTransaction: async (id, lenderTransactionRef, confirmedAt = new Date()) => {
      return (await this.prisma.transaction.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          lenderTransactionRef,
          lenderConfirmedAt: confirmedAt,
        },
      })) as TransactionEntity;
    },
  };

  disbursements: DisbursementStore = {
    record: async (data) => {
      return (await this.prisma.disbursementStatus.create({
        data: {
          lenderApplicationId: data.lenderApplicationId,
          state: data.state as any,
          amountPaise: data.amountPaise,
          lenderReference: data.lenderReference,
          lenderReportedAt: data.lenderReportedAt,
          source: data.source as any,
        },
      })) as DisbursementStatusEntity;
    },
    listByLenderApp: async (lenderApplicationId) => {
      return (await this.prisma.disbursementStatus.findMany({
        where: { lenderApplicationId },
        orderBy: { recordedAt: 'asc' },
      })) as DisbursementStatusEntity[];
    },
  };

  commissions: CommissionStore = {
    accrue: async (data) => {
      return (await this.prisma.commissionEntry.create({
        data: {
          merchantId: data.merchantId,
          applicationId: data.applicationId,
          transactionId: data.transactionId,
          entryType: 'ACCRUAL',
          amountPaise: data.amountPaise,
          ruleCode: data.ruleCode,
          ruleSnapshot: data.ruleSnapshot as any,
          reversesEntryId: null,
          note: data.note,
        },
      })) as CommissionEntryEntity;
    },
    reverse: async (data) => {
      return await this.prisma.$transaction(async (tx) => {
        if (!data.reversesEntryId) {
          throw new ConflictError('reversesEntryId is required for reversal');
        }
        const original = await tx.commissionEntry.findUnique({
          where: { id: data.reversesEntryId },
        });
        if (!original) {
          throw new NotFoundError(`Commission entry ${data.reversesEntryId} not found`);
        }
        if (original.entryType !== 'ACCRUAL') {
          throw new ConflictError('Only ACCRUAL entries can be reversed');
        }

        const existingReversal = await tx.commissionEntry.findFirst({
          where: { reversesEntryId: data.reversesEntryId, entryType: 'REVERSAL' },
        });
        if (existingReversal) {
          throw new ConflictError(
            `Commission entry ${data.reversesEntryId} has already been reversed`,
          );
        }

        return (await tx.commissionEntry.create({
          data: {
            merchantId: original.merchantId,
            applicationId: original.applicationId,
            transactionId: original.transactionId,
            entryType: 'REVERSAL',
            amountPaise: original.amountPaise,
            ruleCode: data.ruleCode,
            ruleSnapshot: data.ruleSnapshot as any,
            reversesEntryId: data.reversesEntryId,
            note: data.note,
          },
        })) as CommissionEntryEntity;
      });
    },
    findById: async (id) => {
      const c = await this.prisma.commissionEntry.findUnique({ where: { id } });
      return c as CommissionEntryEntity | null;
    },
    findReversal: async (accrualEntryId) => {
      const r = await this.prisma.commissionEntry.findFirst({
        where: { reversesEntryId: accrualEntryId, entryType: 'REVERSAL' },
      });
      return r as CommissionEntryEntity | null;
    },
    findByTransaction: async (transactionId) => {
      return (await this.prisma.commissionEntry.findMany({
        where: { transactionId },
      })) as CommissionEntryEntity[];
    },
    listByMerchant: async (merchantId, skip = 0, take = 50) => {
      const [items, total] = await Promise.all([
        this.prisma.commissionEntry.findMany({
          where: { merchantId },
          skip,
          take,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.commissionEntry.count({ where: { merchantId } }),
      ]);
      return { items: items as CommissionEntryEntity[], total };
    },
    getMerchantTotals: async (merchantId) => {
      const entries = await this.prisma.commissionEntry.findMany({
        where: { merchantId },
        select: { entryType: true, amountPaise: true },
      });
      let totalAccruedPaise = 0n;
      let totalReversedPaise = 0n;
      for (const e of entries) {
        if (e.entryType === 'ACCRUAL') totalAccruedPaise += BigInt(e.amountPaise);
        if (e.entryType === 'REVERSAL') totalReversedPaise += BigInt(e.amountPaise);
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
      return (await this.prisma.auditLog.create({
        data: {
          actorType: data.actorType as any,
          actorUserId: data.actorUserId,
          merchantId: data.merchantId,
          action: data.action,
          entityType: data.entityType,
          entityId: data.entityId,
          requestId: data.requestId,
          metadata: data.metadata as any,
        },
      })) as AuditLogEntity;
    },
    list: async (entityType, entityId, skip = 0, take = 50) => {
      const where: any = {};
      if (entityType) where.entityType = entityType;
      if (entityId) where.entityId = entityId;

      const [items, total] = await Promise.all([
        this.prisma.auditLog.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.auditLog.count({ where }),
      ]);
      return { items: items as AuditLogEntity[], total };
    },
  };
}

