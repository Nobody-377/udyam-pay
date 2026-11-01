# Udhyam PAY — Current Integration & Architecture Audit

**Document Reference**: `docs/integration-readiness/CURRENT_INTEGRATION_AUDIT.md`  
**Audit Date**: November 2026  
**Auditor**: Senior Backend Architect & Technical Auditor  
**Repository**: Udhyam PAY Backend  
**Audit Type**: Read-Only Architecture, External Integration & Backend Readiness Inspection  

---

## 1. Executive Architecture Summary

Udhyam PAY is designed as an omni-channel, multi-lender point-of-sale (POS) checkout financing platform in India. It empowers merchants to offer instant digital EMI and consumer loans to customers purchasing electronics and consumer durables.

The platform architecture follows a modular monolith pattern, built on:
- **Runtime**: Node.js 22 LTS with ECMAScript Modules (`"type": "module"` in `package.json`).
- **Language**: TypeScript 5.7+ running in strict mode (`"strict": true`, `"noImplicitAny": true`, `"exactOptionalPropertyTypes": true`).
- **Web Framework**: Express 5.1 with secure middleware stack (`helmet`, `cors`, `pino-http`, custom token-bucket rate limiter).
- **ORM & Database**: Prisma ORM 6.19.3 mapping to PostgreSQL 16 with custom SQL triggers enforcing append-only immutability.
- **Financial Arithmetic**: Strictly integer paise (`BigInt`) for all monetary amounts, preventing IEEE 754 floating-point inaccuracies. Percentages and interest rates use fixed-precision `Decimal(7, 4)`.
- **Identity & Security**: Argon2id password hashing, RS256/HS256 JWT tokens, refresh session family tracking with automatic token reuse theft detection, and strict tenant isolation via `merchantId`.
- **Lending & Orchestration**: Declarative waterfall orchestration supporting sequential priority routing and discovery mode, backed by per-lender circuit breakers and an authoritative state machine.
- **Ledger & Settlement**: Immutable double-entry commission accounting with single-accrual and exact-match reversal controls.
- **Data Minimization (DPDP Act 2023 Compliance)**: Customer profile stores only `fullName` and E.164 `phone`, with explicit consent recording (`CustomerConsent`). No Aadhaar numbers, PAN cards, bank credentials, biometric data, or identity documents are stored in the database.

---

## 2. Verified Implementation Inventory

The table below summarizes the actual implementation status of every module in the repository, grounded in source file inspection and test execution evidence:

| Subsystem / Module | Source File(s) | Primary Interface / Class | Implemented Capabilities | Verified Test Evidence | Audit Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Configuration & Environment** | `src/config/env.ts`<br>`src/config/logger.ts` | `parseEnv()`<br>`createLogger()` | Zod-validated configuration; enforces explicit 32+ char `JWT_SECRET` in production; rejects dev defaults; redacts credential URLs. | `tests/unit/env.test.ts` (18 tests)<br>`tests/unit/logger.test.ts` (3 tests) | **Implemented & Tested** |
| **Authentication & RBAC** | `src/modules/auth/auth.service.ts`<br>`src/modules/auth/token.ts`<br>`src/modules/auth/password.ts`<br>`src/modules/auth/auth.middleware.ts` | `AuthService`<br>`TokenService`<br>`createAuthMiddleware()` | Argon2id hashing; JWT access tokens (15m); opaque refresh tokens (30d) in families; theft reuse detection; 5 failed login lockout; 5 user roles (`ADMIN`, `SYSTEM_ADMIN`, `OPS_AGENT`, `MERCHANT_OWNER`, `MERCHANT_STAFF`). | `tests/unit/auth.test.ts` (5 tests)<br>`scripts/run-verify.js` (Step 2) | **Implemented & Tested** |
| **Merchant & Shop Management** | `src/modules/merchants/merchant.routes.ts`<br>`src/modules/admin/admin.service.ts` | `createMerchantRouter()`<br>`AdminService` | Merchant registration, profile update, shop creation, status lifecycle (`PENDING_VERIFICATION`, `VERIFIED`, `SUSPENDED`). Tenant isolation enforced on all queries. | `tests/e2e/main-flow.test.ts` (Steps 1-3) | **Implemented & Tested** |
| **Customer & DPDP Consent** | `src/modules/customers/customer.routes.ts` | `createCustomerRouter()` | Customer registration (`fullName`, E.164 `phone`); consent recording (`FINANCING_APPLICATION_PROCESSING`, `LENDER_DATA_SHARING`); consent revocation; 365-day retention policy. Zero storage of PAN/Aadhaar. | `tests/e2e/main-flow.test.ts` (Step 4)<br>`scripts/run-verify.js` (Step 12) | **Implemented & Tested** |
| **Purchases & Orders** | `src/modules/purchases/purchase.routes.ts` | `createPurchaseRouter()` | Purchase creation with integer paise amounts; currency validation; product category mapping; merchant idempotency enforcement via `(merchantId, idempotencyKey)`. | `tests/e2e/main-flow.test.ts` (Step 5) | **Implemented & Tested** |
| **Checkout & QR Generation** | `src/modules/checkout/checkout.service.ts`<br>`src/modules/checkout/checkout.routes.ts` | `CheckoutService`<br>`createCheckoutRouter()` | Cryptographically secure random tokens (`cs_<hex48>`); SHA-256 token hashing; atomic consumption; QR code payload generation; public unauthenticated scan endpoint. | `tests/e2e/main-flow.test.ts` (Steps 6-7)<br>`scripts/run-verify.js` (Step 8) | **Implemented & Tested** |
| **Application State Machine** | `src/modules/applications/application-state-machine.ts`<br>`src/modules/applications/application-status.ts` | `assertTransition()`<br>`evaluateTransition()` | 15 distinct states; strict actor permission validation (`MERCHANT_USER`, `ADMIN_USER`, `SYSTEM`, `LENDER`); mandatory `lenderConfirmed` flag for authoritative transitions; zero outgoing transitions from terminal states. | `tests/unit/application-state-machine.test.ts` (32 tests)<br>`scripts/run-verify.js` (Step 1) | **Implemented & Tested** |
| **Financing Applications** | `src/modules/applications/application.service.ts`<br>`src/modules/applications/application.routes.ts` | `ApplicationService`<br>`createApplicationRouter()` | Application creation; at most one active application per purchase invariant; consent verification before submission; cancellation with state transition enforcement; audit status history tracking. | `tests/e2e/main-flow.test.ts` (Steps 8-9)<br>`scripts/run-verify.js` (Step 7) | **Implemented & Tested** |
| **Lender Adapters & EMI Math** | `src/modules/lenders/lender-adapter.interface.ts`<br>`src/modules/lenders/adapters/mock-lender.ts`<br>`src/modules/lenders/emi-calculator.ts`<br>`src/modules/lenders/circuit-breaker.ts` | `LenderAdapter`<br>`MockLenderAdapter`<br>`EmiCalculator`<br>`CircuitBreaker` | Integer paise reducing balance, flat, and 0% EMI calculation; circuit breaker (trips on 3 failures, 30s reset); mock lender with deterministic phone scenarios (`APPROVE`, `DECLINE`, `TIMEOUT`, `503`, `RATE_LIMITED`). | `tests/unit/emi-calculator.test.ts` (4 tests)<br>`tests/unit/mock-lender.test.ts` (6 tests)<br>`tests/unit/circuit-breaker.test.ts` (4 tests) | **Simulated / Mocked** |
| **Waterfall Orchestrator** | `src/modules/orchestration/waterfall.ts`<br>`src/modules/orchestration/result-applier.ts` | `WaterfallOrchestrator`<br>`ResultApplier` | Sequential priority routing; category/ticket filtering; fallback on decline/failure; discovery mode (concurrent queries); BigInt-safe payload hashing (`responseHash`); state transition application. | `tests/unit/waterfall.test.ts` (4 tests)<br>`tests/unit/result-applier.test.ts` (5 tests) | **Implemented & Tested** |
| **Financing Offers** | `src/modules/offers/offer.service.ts`<br>`src/modules/offers/offer.routes.ts` | `OfferService`<br>`createOfferRouter()` | Listing active offers; single offer acceptance; state transition to `CUSTOMER_ACCEPTED_OFFER`; superseding competing offers; expiration validation. | `tests/e2e/main-flow.test.ts` (Steps 10-11) | **Implemented & Tested** |
| **Webhooks Engine** | `src/modules/webhooks/webhook.service.ts`<br>`src/modules/webhooks/webhook.routes.ts` | `WebhookService`<br>`createWebhookRouter()` | HMAC SHA-256 signature verification; 300s replay window validation; SHA-256 payload hashing; idempotent event logging; automated loan disbursement and decline event handlers. | `tests/e2e/main-flow.test.ts` (Step 12)<br>`scripts/run-verify.js` (Step 9) | **Implemented & Tested** |
| **Commission Ledger** | `src/modules/ledger/commission.service.ts`<br>`src/modules/ledger/ledger.routes.ts` | `CommissionService`<br>`createLedgerRouter()` | Double-entry immutable ledger; 1.5% standard commission calculation; single accrual per confirmed transaction; exact-match reversals; merchant commission summary calculations. | `tests/e2e/main-flow.test.ts` (Step 14)<br>`scripts/run-verify.js` (Step 10) | **Implemented & Tested** |
| **Admin Operations** | `src/modules/admin/admin.service.ts`<br>`src/modules/admin/admin.routes.ts` | `AdminService`<br>`createAdminRouter()` | Merchant manual verification and suspension; dynamic lender configuration updates (priority, timeout, category, discovery); immutable audit logging; manual application review handling. | `src/modules/admin/admin.service.ts` | **Implemented & Tested** |
| **Background Workers** | `src/modules/workers/expiration.worker.ts` | `ExpirationWorker` | Automated sweep of expired checkout sessions and stale applications; executes state machine assertions on transition to `EXPIRED`. | `scripts/run-verify.js` (Step 11) | **Implemented & Tested** |

---

## 3. Mock vs. Real Integration Audit (Detailed Breakdown)

The table below provides a rigorous evaluation of every external integration point required for digital lending operations in India, comparing what exists in the repository versus what is required for live operations:

| Provider / Service | Current Codebase Implementation | Integration Type | Authentication Method | API Operations Implemented | Webhooks Supported | Test Coverage | Missing Dependencies | Readiness Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Multi-Lender Aggregator (e.g. FinBox)** | None. In-memory `MockLenderAdapter` registered directly in `server.ts`. | **None (Mocked)** | None. No API keys, client IDs, or mTLS certificates configured. | Simulated `checkEligibility` and `submitApplication` via local delay. | Generic webhook routes exist, but no aggregator signature parser or event normalizer. | Unit tests only test `MockLenderAdapter` local scenarios. | Aggregator contract, API documentation, sandbox credentials, webhook secret. | **BLOCKED / MISSING** |
| **Lender Adapters (Direct NBFC / Bank)** | `src/modules/lenders/adapters/mock-lender.ts` | **Mock** | In-memory configuration string (`secretRef`). | `checkEligibility`, `submitApplication`, `cancelApplication` (all simulated). | `LOAN_DISBURSED`, `LOAN_DECLINED` simulated via HMAC header. | `tests/unit/mock-lender.test.ts`, `tests/unit/waterfall.test.ts` | Direct lender API specifications, partner onboarding, live endpoints. | **MOCKED** |
| **Credit Bureau Integration (CIBIL / Experian / CRIF / Equifax)** | None. Hardcoded rule in `MockLenderAdapter` checks if phone ends in `0001`. | **Missing / Simulated** | None. | None. | None. | Mock phone suffix checks in `mock-lender.test.ts`. | Bureau membership, commercial contract, API credentials, customer bureau consent. | **MISSING** |
| **KYC & Identity Verification (DigiLocker / Aadhaar OTP / CKYC)** | Customer route registers name & phone; records consent notice version. | **Missing** | None. | None. No DigiLocker redirect or Aadhaar OTP flow. | None. | Route tests verify customer phone format only. | KYC provider API (UIDAI / CKYC / DigiLocker via aggregator), KYC verification tokens. | **MISSING** |
| **Bank Account Verification (Penny Drop / IMPS / UPI Name Match)** | None. Database stores zero bank account fields. | **Missing** | None. | None. | None. | None. | Bank verification provider / Aggregator Penny Drop API, account number & IFSC input. | **MISSING** |
| **Bank Statement Analysis (Account Aggregator / Perfios / FinBox)** | `MockLenderAdapter` returns string `"requiredDocument": "BANK_STATEMENT_LAST_3_MONTHS"`. | **Missing / Simulated** | None. | None. No Account Aggregator (AA) consent or PDF upload handler. | None. | Checked as static scenario in `mock-lender.test.ts`. | AA gateway integration (Setu/Finvu/OneMoney) or Aggregator BankConnect SDK. | **MISSING** |
| **Fraud & Device Risk Scoring (FinBox DeviceConnect / Bureau Risk)** | None. | **Missing** | None. | None. | None. | None. | Mobile / Web SDK keys, device risk analytics contract. | **MISSING** |
| **e-Mandate / Recurring Repayment (NPCI e-NACH / UPI Autopay)** | None. | **Missing** | None. | None. | None. | None. | NPCI aggregator integration (Razorpay / Cashfree / Aggregator mandate service). | **MISSING** |
| **Loan Agreement & e-Sign (Aadhaar e-Sign / Digio / Leegality)** | `FinancingOffer` model stores `termsUrl` (points to mock example.com URL). | **Missing / Simulated** | None. | None. No PDF stamping, KFS generation, or Aadhaar e-Sign gateway. | None. | Static string assertion in offer tests. | Document generation service, e-Sign provider (Digio / Leegality / Aggregator e-Sign). | **MISSING** |
| **Key Fact Statement (KFS) & Regulatory Disclosures** | None. Basic APR and EMI stored on `financing_offers`. | **Partial** | None. | None. No formal KFS document or cooling-off period tracking. | None. | EMI calculation tests. | Compliance-approved KFS template conforming to RBI DLG guidelines. | **PARTIAL** |
| **Disbursement Execution & Tracking** | `src/modules/webhooks/webhook.service.ts` processes `LOAN_DISBURSED`. | **Simulated** | HMAC SHA-256 with static dev secret. | Records transaction and triggers commission accrual upon webhook. | `LOAN_DISBURSED`, `DISBURSEMENT_SUCCESSFUL`. | E2E main flow tests simulated webhook delivery. | Real bank/NBFC disbursement notification or aggregator webhook. | **SIMULATED** |
| **Customer Notifications (SMS / WhatsApp / Email / OTP)** | None. Authentication uses password; checkout uses QR code. | **Missing** | None. | None. | None. | None. | SMS gateway (Twilio / Gupshup / Exotel) for OTP and loan status alerts. | **MISSING** |
| **Document Storage & Access (Encrypted Object Vault)** | None. No AWS S3 or GCS bucket configured. | **Missing** | None. | None. | None. | None. | Cloud object storage bucket with CMEK, signed URL generation service. | **MISSING** |
| **Audit & Logging** | `src/config/logger.ts` (Pino), `AuditLog` table with append-only DB trigger. | **Ready** | Local / Cloud Logging. | Audit logging for admin actions, status transitions, and webhooks. | N/A | Tested in E2E flow and unit logger tests. | Centralized log ingestion (e.g. CloudWatch / Datadog / GCP Logging). | **READY** |

---

## 4. Key Architectural Findings & Deficiencies

### Finding 1: Strict DPDP Data Minimization vs Underwriting Prerequisites
The database schema intentionally enforces data minimization:
```prisma
// Customer model in prisma/schema.prisma:
model Customer {
  id                 String    @id @default(uuid()) @db.Uuid
  merchantId         String    @db.Uuid
  fullName           String
  phone              String // E.164 format
  retentionExpiresAt DateTime? @db.Timestamptz(3)
  anonymizedAt       DateTime? @db.Timestamptz(3)
  createdAt          DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt          DateTime  @updatedAt @db.Timestamptz(3)
  // ...
}
```
**Architectural Impact**:
In India, no regulated entity (RE) or aggregator can underwrite a loan without at least:
1. PAN (for Bureau pull and credit appraisal).
2. Date of Birth (DOB) and Residential Pincode.
3. Bank Account details (for penny drop and disbursement).
4. Aadhaar / CKYC / DigiLocker verification.

Because Udhyam PAY does not store PAN or Aadhaar, **Udhyam PAY cannot perform server-to-server underwriting using only its internal database tables**.
**Resolution**: Udhyam PAY must leverage the aggregator's **Embedded Journey / Web SDK / Hosted Webview**, where the customer enters PAN and completes KYC directly within the aggregator's secure, RBI-regulated compliance boundary, returning only tokenized verification references to Udhyam PAY.

### Finding 2: State Machine Lifecycle Gaps Between Offer Acceptance and Disbursement
In `src/modules/applications/application-state-machine.ts`:
```typescript
CUSTOMER_ACCEPTED_OFFER: [
  { to: 'LENDER_FINAL_CONFIRMATION', actors: SYSTEM_ONLY },
  { to: 'TECHNICAL_FAILURE', actors: SYSTEM_ONLY },
  { to: 'MANUAL_REVIEW', actors: SYSTEM_OR_ADMIN },
  { to: 'CANCELLED', actors: CANCELLERS },
  { to: 'EXPIRED', actors: SYSTEM_ONLY },
],
LENDER_FINAL_CONFIRMATION: [
  { to: 'DISBURSEMENT_PENDING', actors: LENDER_BACKED, requiresLenderConfirmation: true },
  { to: 'DECLINED', actors: LENDER_BACKED, requiresLenderConfirmation: true },
  { to: 'TECHNICAL_FAILURE', actors: SYSTEM_ONLY },
  { to: 'MANUAL_REVIEW', actors: SYSTEM_OR_ADMIN },
],
DISBURSEMENT_PENDING: [
  { to: 'DISBURSED', actors: LENDER_BACKED, requiresLenderConfirmation: true },
  { to: 'MANUAL_REVIEW', actors: SYSTEM_OR_ADMIN },
],
```
**Architectural Gap**:
In a real digital lending flow, once the customer accepts an offer, the loan is NOT immediately confirmed. The customer must sequentially:
1. Complete e-Mandate setup (e-NACH via NPCI / NetBanking / Debit Card / UPI Autopay).
2. Review Key Fact Statement (KFS) and complete Aadhaar e-Sign on the loan contract.
3. Pass lender post-sanction verification.

Currently, the state machine jumps from `CUSTOMER_ACCEPTED_OFFER` directly to `LENDER_FINAL_CONFIRMATION` -> `DISBURSEMENT_PENDING` -> `DISBURSED` via webhook. Intermediate states such as `MANDATE_PENDING`, `AGREEMENT_PENDING`, or sub-statuses are not represented.

### Finding 3: Webhook Architecture is Lender-Coupled
`src/modules/webhooks/webhook.service.ts` routes webhooks by `lenderCode`:
```typescript
POST /api/v1/webhooks/lenders/:lenderCode
```
It looks up the lender in the database, retrieves `config.secretRef`, and computes an HMAC SHA-256 signature using a lender-specific secret.
When connecting through an aggregator (e.g., FinBox), all webhooks arrive from the **aggregator's servers** signed with the **aggregator's webhook signing key**, rather than individual banks/NBFCs. The webhook payload contains the aggregator's loan reference, application ID, and events across multiple underlying lenders.

---

## 5. Verification Commands & Test Results

The audit verified the codebase by running all available non-destructive verification tools:

1. **TypeScript Typecheck (`npm run typecheck`)**:
   ```
   > tsc --noEmit
   Result: 0 errors. Clean compilation across all modules.
   ```
2. **Project Logic & Invariant Verification (`npm run test:verify`)**:
   ```
   > node scripts/run-verify.js
   Result: 19/19 tests passed across 12 test suites.
   Verified: State machine rules, Argon2id auth, JWT rotation, integer EMI math, circuit breaker,
   waterfall fallback, idempotency, QR token hashing, webhook HMAC verification, and commission ledger.
   ```
3. **Vitest Unit & Integration Suite (`npm test` with bypass sandbox for port binding)**:
   ```
   > vitest run
   Result: 13 test files passed, 112/112 tests passed.
   Execution time: 2.48s.
   ```
4. **Production Build (`npm run build`)**:
   ```
   > tsc -p tsconfig.build.json
   Result: 0 errors. Output emitted to dist/.
   ```

---

## 6. Audit Conclusion

The Udhyam PAY backend has a solid architectural core: its security, state management, money arithmetic, tenant isolation, and commission accounting are fully implemented, tested, and production-grade.

However, **all external lending and verification operations are currently 100% simulated via `MockLenderAdapter`**. There are no live external API connections, credentials, or third-party SDKs. The platform is ready for aggregator integration, provided a clean abstraction layer is introduced.

