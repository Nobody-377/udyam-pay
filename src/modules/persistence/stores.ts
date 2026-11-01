import type {
  ActorType,
  ApplicationStatus,
} from '../applications/application-status';

export type { ActorType, ApplicationStatus };

export type UserRole =
  | 'ADMIN'
  | 'SYSTEM_ADMIN'
  | 'OPS_AGENT'
  | 'MERCHANT_OWNER'
  | 'MERCHANT_STAFF';
export type UserStatus = 'ACTIVE' | 'SUSPENDED';
export type MerchantStatus = 'PENDING_VERIFICATION' | 'VERIFIED' | 'SUSPENDED';
export type ShopStatus = 'ACTIVE' | 'INACTIVE';
export type ProductCategory =
  | 'SMARTPHONE'
  | 'TELEVISION'
  | 'REFRIGERATOR'
  | 'WASHING_MACHINE'
  | 'AIR_CONDITIONER'
  | 'LAPTOP'
  | 'OTHER_ELECTRONICS';

export type ConsentPurpose = 'FINANCING_APPLICATION_PROCESSING' | 'LENDER_DATA_SHARING';
export type ConsentCaptureMethod = 'CUSTOMER_CHECKOUT_SESSION' | 'MERCHANT_ASSISTED';
export type CheckoutSessionStatus = 'ACTIVE' | 'CONSUMED' | 'EXPIRED' | 'REVOKED';
export type RoutingMode = 'SEQUENTIAL' | 'DISCOVERY';
export type LenderType = 'BANK' | 'NBFC' | 'OTHER';
export type LenderStatus = 'ACTIVE' | 'INACTIVE';
export type LenderAttemptOutcome =
  | 'PENDING'
  | 'OFFERED'
  | 'DECLINED'
  | 'ADDITIONAL_INFO_REQUIRED'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'MALFORMED_RESPONSE'
  | 'UNKNOWN'
  | 'RECONCILING'
  | 'CANCELLED';

export type OfferType = 'INDICATIVE_ELIGIBILITY' | 'FIRM_OFFER';
export type OfferStatus = 'ACTIVE' | 'ACCEPTED' | 'EXPIRED' | 'WITHDRAWN' | 'SUPERSEDED';
export type RateType = 'FIXED' | 'FLOATING' | 'FLAT' | 'REDUCING_BALANCE' | 'UNSPECIFIED';
export type WebhookProcessingStatus =
  | 'RECEIVED'
  | 'PROCESSED'
  | 'FAILED'
  | 'REJECTED_INVALID_SIGNATURE'
  | 'IGNORED_OUT_OF_ORDER';

export type TransactionType =
  | 'PURCHASE_PAYMENT'
  | 'LOAN_DISBURSEMENT'
  | 'MERCHANT_SETTLEMENT'
  | 'REFUND';
export type TransactionStatus = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REVERSED';
export type ReconciliationStatus = 'UNRECONCILED' | 'MATCHED' | 'MISMATCHED';
export type DisbursementState = 'PENDING' | 'DISBURSED' | 'FAILED' | 'UNKNOWN';
export type CommissionEntryType = 'ACCRUAL' | 'REVERSAL' | 'ADJUSTMENT';

// Entity definitions
export interface UserEntity {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  merchantId: string | null;
  tokenVersion: number;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefreshSessionEntity {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface MerchantEntity {
  id: string;
  legalName: string;
  tradeName: string | null;
  status: MerchantStatus;
  verifiedAt: Date | null;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShopEntity {
  id: string;
  merchantId: string;
  name: string;
  city: string;
  state: string;
  status: ShopStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerEntity {
  id: string;
  merchantId: string;
  fullName: string;
  phone: string;
  retentionExpiresAt: Date | null;
  anonymizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerConsentEntity {
  id: string;
  merchantId: string;
  customerId: string;
  purpose: ConsentPurpose;
  noticeVersion: string;
  captureMethod: ConsentCaptureMethod;
  grantedAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface PurchaseEntity {
  id: string;
  merchantId: string;
  shopId: string;
  customerId: string | null;
  productCategory: ProductCategory;
  productDescription: string | null;
  amountPaise: bigint;
  currency: string;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CheckoutSessionEntity {
  id: string;
  merchantId: string;
  shopId: string;
  purchaseId: string;
  createdByUserId: string | null;
  tokenHash: string;
  status: CheckoutSessionStatus;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface LenderEntity {
  id: string;
  code: string;
  displayName: string;
  type: LenderType;
  isSimulated: boolean;
  status: LenderStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface LenderConfigurationEntity {
  id: string;
  lenderId: string;
  enabled: boolean;
  priority: number;
  minAmountPaise: bigint | null;
  maxAmountPaise: bigint | null;
  supportedCategories: ProductCategory[];
  supportsDiscovery: boolean;
  fallbackOnDecline: boolean;
  requestTimeoutMs: number;
  maxSafeRetries: number;
  routingRules: unknown | null;
  secretRef: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FinancingApplicationEntity {
  id: string;
  merchantId: string;
  shopId: string;
  purchaseId: string;
  customerId: string;
  createdByUserId: string | null;
  status: ApplicationStatus;
  routingMode: RoutingMode;
  requestedAmountPaise: bigint;
  downPaymentPaise: bigint;
  requestedTenureMonths: number | null;
  idempotencyKey: string;
  version: number;
  submittedAt: Date | null;
  expiresAt: Date | null;
  terminalAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApplicationStatusHistoryEntity {
  id: string;
  applicationId: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  actorType: ActorType;
  actorId: string | null;
  reason: string | null;
  metadata: unknown | null;
  createdAt: Date;
}

export interface LenderApplicationEntity {
  id: string;
  applicationId: string;
  merchantId: string;
  lenderId: string;
  attemptNo: number;
  requestKey: string;
  externalReference: string | null;
  outcome: LenderAttemptOutcome;
  errorCode: string | null;
  responseHash: string | null;
  safeResponseSummary: unknown | null;
  reconcileAttempts: number;
  startedAt: Date;
  completedAt: Date | null;
  latencyMs: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FinancingOfferEntity {
  id: string;
  applicationId: string;
  lenderApplicationId: string;
  merchantId: string;
  lenderId: string;
  offerType: OfferType;
  status: OfferStatus;
  lenderOfferReference: string;
  principalPaise: bigint;
  downPaymentPaise: bigint | null;
  tenureMonths: number;
  interestRatePercent: string | null;
  rateType: RateType;
  aprPercent: string | null;
  emiPaise: bigint;
  processingFeePaise: bigint | null;
  taxesPaise: bigint | null;
  otherChargesPaise: bigint | null;
  totalRepayablePaise: bigint | null;
  repaymentSchedule: unknown | null;
  termsVersion: string | null;
  termsUrl: string | null;
  expiresAt: Date | null;
  isSimulated: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookEventEntity {
  id: string;
  lenderId: string;
  lenderApplicationId: string | null;
  eventId: string;
  eventType: string | null;
  signatureValid: boolean;
  processingStatus: WebhookProcessingStatus;
  payloadHash: string;
  safePayloadSummary: unknown | null;
  errorCode: string | null;
  receivedAt: Date;
  processedAt: Date | null;
}

export interface TransactionEntity {
  id: string;
  merchantId: string;
  applicationId: string;
  lenderApplicationId: string | null;
  lenderId: string | null;
  type: TransactionType;
  status: TransactionStatus;
  amountPaise: bigint;
  lenderTransactionRef: string | null;
  lenderConfirmedAt: Date | null;
  reconciliationStatus: ReconciliationStatus;
  reconciledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DisbursementStatusEntity {
  id: string;
  lenderApplicationId: string;
  state: DisbursementState;
  amountPaise: bigint | null;
  lenderReference: string | null;
  lenderReportedAt: Date | null;
  source: ActorType;
  recordedAt: Date;
}

export interface CommissionEntryEntity {
  id: string;
  merchantId: string;
  applicationId: string;
  transactionId: string;
  entryType: CommissionEntryType;
  amountPaise: bigint;
  ruleCode: string;
  ruleSnapshot: unknown;
  reversesEntryId: string | null;
  note: string | null;
  createdAt: Date;
}

export interface AuditLogEntity {
  id: string;
  actorType: ActorType;
  actorUserId: string | null;
  merchantId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  requestId: string | null;
  metadata: unknown | null;
  createdAt: Date;
}

// Stores interfaces
export interface UserStore {
  create(data: Omit<UserEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<UserEntity>;
  findById(id: string): Promise<UserEntity | null>;
  findByEmail(email: string): Promise<UserEntity | null>;
  incrementFailedLogin(id: string, lockUntil?: Date): Promise<void>;
  resetFailedLogin(id: string): Promise<void>;
  incrementTokenVersion(id: string): Promise<void>;
  updateLastLogin(id: string, at?: Date): Promise<void>;
  listUsers(merchantId?: string): Promise<UserEntity[]>;
}

export interface RefreshSessionStore {
  create(data: Omit<RefreshSessionEntity, 'id' | 'createdAt'>): Promise<RefreshSessionEntity>;
  findByTokenHash(hash: string): Promise<RefreshSessionEntity | null>;
  rotateSession(id: string, newSession: Omit<RefreshSessionEntity, 'id' | 'createdAt'>): Promise<RefreshSessionEntity>;
  revokeFamily(familyId: string): Promise<void>;
  revokeUserSessions(userId: string): Promise<void>;
}

export interface MerchantStore {
  create(data: Omit<MerchantEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<MerchantEntity>;
  findById(id: string): Promise<MerchantEntity | null>;
  list(status?: MerchantStatus): Promise<MerchantEntity[]>;
  updateStatus(id: string, status: MerchantStatus, reason?: string): Promise<MerchantEntity>;
}

export interface ShopStore {
  create(data: Omit<ShopEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<ShopEntity>;
  findById(id: string): Promise<ShopEntity | null>;
  listByMerchant(merchantId: string): Promise<ShopEntity[]>;
}

export interface CustomerStore {
  create(data: Omit<CustomerEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<CustomerEntity>;
  findById(id: string): Promise<CustomerEntity | null>;
  findByPhone(merchantId: string, phone: string): Promise<CustomerEntity | null>;
  anonymizeCustomer(id: string): Promise<void>;
}

export interface ConsentStore {
  create(data: Omit<CustomerConsentEntity, 'id' | 'createdAt'>): Promise<CustomerConsentEntity>;
  findActive(customerId: string, purpose: ConsentPurpose): Promise<CustomerConsentEntity | null>;
  revoke(id: string): Promise<void>;
  listByCustomer(customerId: string): Promise<CustomerConsentEntity[]>;
}

export interface PurchaseStore {
  createIdempotent(data: Omit<PurchaseEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<PurchaseEntity>;
  findById(id: string): Promise<PurchaseEntity | null>;
  listByMerchant(merchantId: string, skip?: number, take?: number): Promise<{ items: PurchaseEntity[]; total: number }>;
}

export interface CheckoutSessionStore {
  create(data: Omit<CheckoutSessionEntity, 'id' | 'createdAt'>): Promise<CheckoutSessionEntity>;
  findByTokenHash(hash: string): Promise<CheckoutSessionEntity | null>;
  findById(id: string): Promise<CheckoutSessionEntity | null>;
  markConsumed(id: string): Promise<void>;
  markExpired(id: string): Promise<void>;
  markRevoked(id: string): Promise<void>;
  findExpired(asOf?: Date, limit?: number): Promise<CheckoutSessionEntity[]>;
}

export interface LenderStore {
  create(data: Omit<LenderEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<LenderEntity>;
  findById(id: string): Promise<LenderEntity | null>;
  findByCode(code: string): Promise<LenderEntity | null>;
  list(status?: LenderStatus): Promise<LenderEntity[]>;
  getConfig(lenderId: string): Promise<LenderConfigurationEntity | null>;
  saveConfig(data: Omit<LenderConfigurationEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<LenderConfigurationEntity>;
}

export interface ApplicationStore {
  create(data: Omit<FinancingApplicationEntity, 'id' | 'version' | 'createdAt' | 'updatedAt'>): Promise<FinancingApplicationEntity>;
  findById(id: string): Promise<FinancingApplicationEntity | null>;
  findByIdempotency(merchantId: string, key: string): Promise<FinancingApplicationEntity | null>;
  findActiveByPurchase(purchaseId: string): Promise<FinancingApplicationEntity | null>;
  updateStatus(params: {
    id: string;
    expectedVersion: number;
    toStatus: ApplicationStatus;
    actorType: ActorType;
    actorId?: string;
    reason?: string;
    metadata?: unknown;
    terminalAt?: Date;
    submittedAt?: Date;
  }): Promise<FinancingApplicationEntity>;
  getStatusHistory(applicationId: string): Promise<ApplicationStatusHistoryEntity[]>;
  listByMerchant(merchantId: string, skip?: number, take?: number): Promise<{ items: FinancingApplicationEntity[]; total: number }>;
  findExpired(asOf?: Date, limit?: number): Promise<FinancingApplicationEntity[]>;
}

export interface LenderApplicationStore {
  create(data: Omit<LenderApplicationEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<LenderApplicationEntity>;
  findById(id: string): Promise<LenderApplicationEntity | null>;
  findByRequestKey(requestKey: string): Promise<LenderApplicationEntity | null>;
  listByApplication(applicationId: string): Promise<LenderApplicationEntity[]>;
  updateOutcome(params: {
    id: string;
    outcome: LenderAttemptOutcome;
    externalReference?: string;
    errorCode?: string;
    responseHash?: string;
    safeResponseSummary?: unknown;
    latencyMs?: number;
    completedAt?: Date;
  }): Promise<LenderApplicationEntity>;
}

export interface OfferStore {
  create(data: Omit<FinancingOfferEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<FinancingOfferEntity>;
  findById(id: string): Promise<FinancingOfferEntity | null>;
  listByApplication(applicationId: string, status?: OfferStatus): Promise<FinancingOfferEntity[]>;
  updateStatus(id: string, status: OfferStatus): Promise<void>;
  supersedeOthers(applicationId: string, acceptedOfferId: string): Promise<void>;
}

export interface WebhookStore {
  recordReceived(data: Omit<WebhookEventEntity, 'id' | 'receivedAt'>): Promise<WebhookEventEntity>;
  findByEvent(lenderId: string, eventId: string): Promise<WebhookEventEntity | null>;
  markProcessed(id: string, status: WebhookProcessingStatus, errorCode?: string): Promise<void>;
}

export interface TransactionStore {
  create(data: Omit<TransactionEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<TransactionEntity>;
  findById(id: string): Promise<TransactionEntity | null>;
  findByApplication(applicationId: string): Promise<TransactionEntity[]>;
  confirmTransaction(id: string, lenderTransactionRef: string, confirmedAt?: Date): Promise<TransactionEntity>;
}

export interface DisbursementStore {
  record(data: Omit<DisbursementStatusEntity, 'id' | 'recordedAt'>): Promise<DisbursementStatusEntity>;
  listByLenderApp(lenderApplicationId: string): Promise<DisbursementStatusEntity[]>;
}

export interface CommissionTotals {
  totalAccruedPaise: bigint;
  totalReversedPaise: bigint;
  netCommissionPaise: bigint;
}

export interface CommissionStore {
  accrue(data: Omit<CommissionEntryEntity, 'id' | 'createdAt'>): Promise<CommissionEntryEntity>;
  reverse(data: Omit<CommissionEntryEntity, 'id' | 'createdAt'>): Promise<CommissionEntryEntity>;
  findById(id: string): Promise<CommissionEntryEntity | null>;
  findReversal(accrualEntryId: string): Promise<CommissionEntryEntity | null>;
  findByTransaction(transactionId: string): Promise<CommissionEntryEntity[]>;
  listByMerchant(
    merchantId: string,
    skip?: number,
    take?: number,
  ): Promise<{ items: CommissionEntryEntity[]; total: number }>;
  getMerchantTotals(merchantId: string): Promise<CommissionTotals>;
}

export interface AuditLogStore {
  record(data: Omit<AuditLogEntity, 'id' | 'createdAt'>): Promise<AuditLogEntity>;
  list(entityType?: string, entityId?: string, skip?: number, take?: number): Promise<{ items: AuditLogEntity[]; total: number }>;
}

export interface AppStores {
  users: UserStore;
  refreshSessions: RefreshSessionStore;
  merchants: MerchantStore;
  shops: ShopStore;
  customers: CustomerStore;
  consents: ConsentStore;
  purchases: PurchaseStore;
  checkoutSessions: CheckoutSessionStore;
  lenders: LenderStore;
  applications: ApplicationStore;
  lenderApplications: LenderApplicationStore;
  offers: OfferStore;
  webhooks: WebhookStore;
  transactions: TransactionStore;
  disbursements: DisbursementStore;
  commissions: CommissionStore;
  auditLogs: AuditLogStore;
}
