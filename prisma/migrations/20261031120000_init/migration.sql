-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'SYSTEM_ADMIN', 'OPS_AGENT', 'MERCHANT_OWNER', 'MERCHANT_STAFF');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ShopStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('SMARTPHONE', 'TELEVISION', 'REFRIGERATOR', 'WASHING_MACHINE', 'AIR_CONDITIONER', 'LAPTOP', 'OTHER_ELECTRONICS');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('FINANCING_APPLICATION_PROCESSING', 'LENDER_DATA_SHARING');

-- CreateEnum
CREATE TYPE "ConsentCaptureMethod" AS ENUM ('CUSTOMER_CHECKOUT_SESSION', 'MERCHANT_ASSISTED');

-- CreateEnum
CREATE TYPE "CheckoutSessionStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'CUSTOMER_CONSENT_PENDING', 'SUBMITTED', 'LENDER_PROCESSING', 'OFFER_AVAILABLE', 'ADDITIONAL_INFORMATION_REQUIRED', 'DECLINED', 'CUSTOMER_ACCEPTED_OFFER', 'LENDER_FINAL_CONFIRMATION', 'DISBURSEMENT_PENDING', 'DISBURSED', 'CANCELLED', 'EXPIRED', 'TECHNICAL_FAILURE', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('MERCHANT_USER', 'ADMIN_USER', 'SYSTEM', 'LENDER');

-- CreateEnum
CREATE TYPE "RoutingMode" AS ENUM ('SEQUENTIAL', 'DISCOVERY');

-- CreateEnum
CREATE TYPE "LenderType" AS ENUM ('BANK', 'NBFC', 'OTHER');

-- CreateEnum
CREATE TYPE "LenderStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "LenderAttemptOutcome" AS ENUM ('PENDING', 'OFFERED', 'DECLINED', 'ADDITIONAL_INFO_REQUIRED', 'TIMEOUT', 'UNAVAILABLE', 'RATE_LIMITED', 'MALFORMED_RESPONSE', 'UNKNOWN', 'RECONCILING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('INDICATIVE_ELIGIBILITY', 'FIRM_OFFER');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('ACTIVE', 'ACCEPTED', 'EXPIRED', 'WITHDRAWN', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RateType" AS ENUM ('FIXED', 'FLOATING', 'FLAT', 'REDUCING_BALANCE', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'REJECTED_INVALID_SIGNATURE', 'IGNORED_OUT_OF_ORDER');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('PURCHASE_PAYMENT', 'LOAN_DISBURSEMENT', 'MERCHANT_SETTLEMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('UNRECONCILED', 'MATCHED', 'MISMATCHED');

-- CreateEnum
CREATE TYPE "DisbursementState" AS ENUM ('PENDING', 'DISBURSED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CommissionEntryType" AS ENUM ('ACCRUAL', 'REVERSAL', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "status" "MerchantStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "verifiedAt" TIMESTAMPTZ(3),
    "suspendedAt" TIMESTAMPTZ(3),
    "suspensionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "merchantId" UUID,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "replacedById" UUID,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shops" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "status" "ShopStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "retentionExpiresAt" TIMESTAMPTZ(3),
    "anonymizedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_consents" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "captureMethod" "ConsentCaptureMethod" NOT NULL,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "customerId" UUID,
    "productCategory" "ProductCategory" NOT NULL,
    "productDescription" TEXT,
    "amountPaise" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_sessions" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "purchaseId" UUID NOT NULL,
    "createdByUserId" UUID,
    "tokenHash" TEXT NOT NULL,
    "status" "CheckoutSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lenders" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "type" "LenderType" NOT NULL,
    "isSimulated" BOOLEAN NOT NULL DEFAULT true,
    "status" "LenderStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lender_configurations" (
    "id" UUID NOT NULL,
    "lenderId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "minAmountPaise" BIGINT,
    "maxAmountPaise" BIGINT,
    "supportedCategories" "ProductCategory"[],
    "supportsDiscovery" BOOLEAN NOT NULL DEFAULT false,
    "fallbackOnDecline" BOOLEAN NOT NULL DEFAULT true,
    "requestTimeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "maxSafeRetries" INTEGER NOT NULL DEFAULT 2,
    "routingRules" JSONB,
    "secretRef" TEXT,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lender_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financing_applications" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "purchaseId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "createdByUserId" UUID,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "routingMode" "RoutingMode" NOT NULL DEFAULT 'SEQUENTIAL',
    "requestedAmountPaise" BIGINT NOT NULL,
    "downPaymentPaise" BIGINT NOT NULL DEFAULT 0,
    "requestedTenureMonths" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "terminalAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "financing_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_status_history" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "fromStatus" "ApplicationStatus",
    "toStatus" "ApplicationStatus" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lender_applications" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "lenderId" UUID NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "requestKey" TEXT NOT NULL,
    "externalReference" TEXT,
    "outcome" "LenderAttemptOutcome" NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "responseHash" TEXT,
    "safeResponseSummary" JSONB,
    "reconcileAttempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lender_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financing_offers" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "lenderApplicationId" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "lenderId" UUID NOT NULL,
    "offerType" "OfferType" NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'ACTIVE',
    "lenderOfferReference" TEXT NOT NULL,
    "principalPaise" BIGINT NOT NULL,
    "downPaymentPaise" BIGINT,
    "tenureMonths" INTEGER NOT NULL,
    "interestRatePercent" DECIMAL(7,4),
    "rateType" "RateType" NOT NULL DEFAULT 'UNSPECIFIED',
    "aprPercent" DECIMAL(7,4),
    "emiPaise" BIGINT NOT NULL,
    "processingFeePaise" BIGINT,
    "taxesPaise" BIGINT,
    "otherChargesPaise" BIGINT,
    "totalRepayablePaise" BIGINT,
    "repaymentSchedule" JSONB,
    "termsVersion" TEXT,
    "termsUrl" TEXT,
    "expiresAt" TIMESTAMPTZ(3),
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "financing_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "lenderId" UUID NOT NULL,
    "lenderApplicationId" UUID,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT,
    "signatureValid" BOOLEAN NOT NULL,
    "processingStatus" "WebhookProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "payloadHash" TEXT NOT NULL,
    "safePayloadSummary" JSONB,
    "errorCode" TEXT,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "lenderApplicationId" UUID,
    "lenderId" UUID,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amountPaise" BIGINT NOT NULL,
    "lenderTransactionRef" TEXT,
    "lenderConfirmedAt" TIMESTAMPTZ(3),
    "reconciliationStatus" "ReconciliationStatus" NOT NULL DEFAULT 'UNRECONCILED',
    "reconciledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disbursement_statuses" (
    "id" UUID NOT NULL,
    "lenderApplicationId" UUID NOT NULL,
    "state" "DisbursementState" NOT NULL,
    "amountPaise" BIGINT,
    "lenderReference" TEXT,
    "lenderReportedAt" TIMESTAMPTZ(3),
    "source" "ActorType" NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disbursement_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_entries" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "entryType" "CommissionEntryType" NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "reversesEntryId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorUserId" UUID,
    "merchantId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "requestId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchants_status_idx" ON "merchants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_merchantId_idx" ON "users"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_tokenHash_key" ON "refresh_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_sessions_userId_idx" ON "refresh_sessions"("userId");

-- CreateIndex
CREATE INDEX "refresh_sessions_familyId_idx" ON "refresh_sessions"("familyId");

-- CreateIndex
CREATE INDEX "refresh_sessions_expiresAt_idx" ON "refresh_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "shops_merchantId_idx" ON "shops"("merchantId");

-- CreateIndex
CREATE INDEX "customers_retentionExpiresAt_idx" ON "customers"("retentionExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "customers_merchantId_phone_key" ON "customers"("merchantId", "phone");

-- CreateIndex
CREATE INDEX "customer_consents_customerId_purpose_idx" ON "customer_consents"("customerId", "purpose");

-- CreateIndex
CREATE INDEX "customer_consents_merchantId_idx" ON "customer_consents"("merchantId");

-- CreateIndex
CREATE INDEX "purchases_merchantId_createdAt_idx" ON "purchases"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "purchases_shopId_idx" ON "purchases"("shopId");

-- CreateIndex
CREATE INDEX "purchases_customerId_idx" ON "purchases"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_merchantId_idempotencyKey_key" ON "purchases"("merchantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_sessions_tokenHash_key" ON "checkout_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "checkout_sessions_merchantId_idx" ON "checkout_sessions"("merchantId");

-- CreateIndex
CREATE INDEX "checkout_sessions_purchaseId_idx" ON "checkout_sessions"("purchaseId");

-- CreateIndex
CREATE INDEX "checkout_sessions_expiresAt_idx" ON "checkout_sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "lenders_code_key" ON "lenders"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lender_configurations_lenderId_key" ON "lender_configurations"("lenderId");

-- CreateIndex
CREATE INDEX "financing_applications_merchantId_status_createdAt_idx" ON "financing_applications"("merchantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "financing_applications_purchaseId_idx" ON "financing_applications"("purchaseId");

-- CreateIndex
CREATE INDEX "financing_applications_customerId_idx" ON "financing_applications"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "financing_applications_merchantId_idempotencyKey_key" ON "financing_applications"("merchantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "application_status_history_applicationId_createdAt_idx" ON "application_status_history"("applicationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "lender_applications_requestKey_key" ON "lender_applications"("requestKey");

-- CreateIndex
CREATE INDEX "lender_applications_merchantId_idx" ON "lender_applications"("merchantId");

-- CreateIndex
CREATE INDEX "lender_applications_applicationId_idx" ON "lender_applications"("applicationId");

-- CreateIndex
CREATE INDEX "lender_applications_outcome_idx" ON "lender_applications"("outcome");

-- CreateIndex
CREATE UNIQUE INDEX "lender_applications_applicationId_attemptNo_key" ON "lender_applications"("applicationId", "attemptNo");

-- CreateIndex
CREATE UNIQUE INDEX "lender_applications_lenderId_externalReference_key" ON "lender_applications"("lenderId", "externalReference");

-- CreateIndex
CREATE INDEX "financing_offers_applicationId_idx" ON "financing_offers"("applicationId");

-- CreateIndex
CREATE INDEX "financing_offers_merchantId_idx" ON "financing_offers"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "financing_offers_lenderId_lenderOfferReference_key" ON "financing_offers"("lenderId", "lenderOfferReference");

-- CreateIndex
CREATE INDEX "webhook_events_lenderApplicationId_idx" ON "webhook_events"("lenderApplicationId");

-- CreateIndex
CREATE INDEX "webhook_events_processingStatus_receivedAt_idx" ON "webhook_events"("processingStatus", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_lenderId_eventId_key" ON "webhook_events"("lenderId", "eventId");

-- CreateIndex
CREATE INDEX "transactions_merchantId_createdAt_idx" ON "transactions"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_applicationId_idx" ON "transactions"("applicationId");

-- CreateIndex
CREATE INDEX "transactions_reconciliationStatus_idx" ON "transactions"("reconciliationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_lenderId_lenderTransactionRef_type_key" ON "transactions"("lenderId", "lenderTransactionRef", "type");

-- CreateIndex
CREATE INDEX "disbursement_statuses_lenderApplicationId_recordedAt_idx" ON "disbursement_statuses"("lenderApplicationId", "recordedAt");

-- CreateIndex
CREATE INDEX "commission_entries_merchantId_createdAt_idx" ON "commission_entries"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "commission_entries_transactionId_idx" ON "commission_entries"("transactionId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_merchantId_createdAt_idx" ON "audit_logs"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_idx" ON "audit_logs"("actorUserId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shops" ADD CONSTRAINT "shops_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_configurations" ADD CONSTRAINT "lender_configurations_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "lenders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financing_applications" ADD CONSTRAINT "financing_applications_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financing_applications" ADD CONSTRAINT "financing_applications_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financing_applications" ADD CONSTRAINT "financing_applications_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financing_applications" ADD CONSTRAINT "financing_applications_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "financing_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_applications" ADD CONSTRAINT "lender_applications_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "financing_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_applications" ADD CONSTRAINT "lender_applications_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_applications" ADD CONSTRAINT "lender_applications_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "lenders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financing_offers" ADD CONSTRAINT "financing_offers_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "financing_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financing_offers" ADD CONSTRAINT "financing_offers_lenderApplicationId_fkey" FOREIGN KEY ("lenderApplicationId") REFERENCES "lender_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financing_offers" ADD CONSTRAINT "financing_offers_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financing_offers" ADD CONSTRAINT "financing_offers_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "lenders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "lenders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_lenderApplicationId_fkey" FOREIGN KEY ("lenderApplicationId") REFERENCES "lender_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "financing_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_lenderApplicationId_fkey" FOREIGN KEY ("lenderApplicationId") REFERENCES "lender_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "lenders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursement_statuses" ADD CONSTRAINT "disbursement_statuses_lenderApplicationId_fkey" FOREIGN KEY ("lenderApplicationId") REFERENCES "lender_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "financing_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_reversesEntryId_fkey" FOREIGN KEY ("reversesEntryId") REFERENCES "commission_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Money sanity checks (amounts are integer paise)
-- ---------------------------------------------------------------------------
ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_amount_positive" CHECK ("amountPaise" > 0);

ALTER TABLE "financing_applications"
  ADD CONSTRAINT "financing_applications_amounts_valid"
  CHECK ("requestedAmountPaise" > 0 AND "downPaymentPaise" >= 0);

ALTER TABLE "financing_offers"
  ADD CONSTRAINT "financing_offers_terms_valid"
  CHECK ("principalPaise" > 0 AND "emiPaise" > 0 AND "tenureMonths" > 0);

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_amount_positive" CHECK ("amountPaise" > 0);

ALTER TABLE "commission_entries"
  ADD CONSTRAINT "commission_entries_amount_positive" CHECK ("amountPaise" > 0);

ALTER TABLE "disbursement_statuses"
  ADD CONSTRAINT "disbursement_statuses_amount_positive"
  CHECK ("amountPaise" IS NULL OR "amountPaise" > 0);

ALTER TABLE "financing_offers"
  ADD CONSTRAINT "financing_offers_fees_valid"
  CHECK (
    ("downPaymentPaise" IS NULL OR "downPaymentPaise" >= 0) AND
    ("processingFeePaise" IS NULL OR "processingFeePaise" >= 0) AND
    ("taxesPaise" IS NULL OR "taxesPaise" >= 0) AND
    ("otherChargesPaise" IS NULL OR "otherChargesPaise" >= 0) AND
    ("totalRepayablePaise" IS NULL OR "totalRepayablePaise" >= "principalPaise")
  );

ALTER TABLE "lender_configurations"
  ADD CONSTRAINT "lender_configurations_amount_range_valid"
  CHECK ("minAmountPaise" IS NULL OR "maxAmountPaise" IS NULL OR "minAmountPaise" <= "maxAmountPaise");

-- ---------------------------------------------------------------------------
-- Commission entry unique constraints: one accrual per transaction, unique reversal
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "commission_entries_one_accrual_per_transaction"
  ON "commission_entries" ("transactionId")
  WHERE "entryType" = 'ACCRUAL';

CREATE UNIQUE INDEX "commission_entries_unique_reversal"
  ON "commission_entries" ("reversesEntryId")
  WHERE "reversesEntryId" IS NOT NULL AND "entryType" = 'REVERSAL';

-- ---------------------------------------------------------------------------
-- At most one active (non-terminal) application per purchase
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "financing_applications_one_active_per_purchase"
  ON "financing_applications" ("purchaseId")
  WHERE "status" NOT IN ('DECLINED', 'DISBURSED', 'CANCELLED', 'EXPIRED');

-- ---------------------------------------------------------------------------
-- Append-only tables: block UPDATE and DELETE at the database level.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION udyam_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "application_status_history_append_only"
  BEFORE UPDATE OR DELETE ON "application_status_history"
  FOR EACH ROW EXECUTE FUNCTION udyam_forbid_mutation();

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION udyam_forbid_mutation();

CREATE TRIGGER "commission_entries_append_only"
  BEFORE UPDATE OR DELETE ON "commission_entries"
  FOR EACH ROW EXECUTE FUNCTION udyam_forbid_mutation();

CREATE TRIGGER "disbursement_statuses_append_only"
  BEFORE UPDATE OR DELETE ON "disbursement_statuses"
  FOR EACH ROW EXECUTE FUNCTION udyam_forbid_mutation();

