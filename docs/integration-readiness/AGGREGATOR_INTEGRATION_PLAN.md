# Udhyam PAY — Aggregator Integration Plan & Architecture Strategy

**Document Reference**: `docs/integration-readiness/AGGREGATOR_INTEGRATION_PLAN.md`  
**Date**: November 2026  
**Audience**: Backend Engineers, Systems Architects, Integration Specialists  
**Target Aggregators**: FinBox, Setu, or equivalent multi-lender credit aggregator  

---

## 1. Architectural Vision & Decoupling Strategy

The primary objective of Udhyam PAY is to retain complete ownership and control over:
1. **Merchant Portal & Onboarding**: KYC, shop hierarchy, sales executive logins, and merchant dashboards.
2. **Customer Point-of-Sale Experience**: In-store QR code generation, mobile checkout web application, purchase tracking, and multi-offer comparison interface.
3. **Internal Data Models & State Machine**: Append-only status histories, optimistic locking, idempotent submissions, and audit logging.
4. **Merchant Commission Accounting**: Double-entry ledger calculating originations, accruals, reversals, and merchant settlements.

To achieve this without being locked into a single aggregator (such as FinBox) or rewriting core business logic when partner capabilities change, Udhyam PAY must introduce a **Unified Provider Abstraction Layer**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                   UDHYAM PAY DOMAIN APPLICATION LAYER                  │
│                                                                        │
│   ┌───────────────┐   ┌────────────────┐   ┌───────────────────────┐   │
│   │  Auth & RBAC  │   │  Merchants &   │   │  Checkout & Purchases │   │
│   │   (Argon2)    │   │     Shops      │   │       (QR Token)      │   │
│   └───────────────┘   └────────────────┘   └───────────────────────┘   │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │          Financing Applications & State Machine                │   │
│   │          (15 States, Optimistic Locking, Audit Trail)          │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
│                                   │                                    │
│   ┌───────────────────────────────▼────────────────────────────────┐   │
│   │            Multi-Lender Waterfall Orchestration                │   │
│   │            (Priority Routing & Discovery Mode)                 │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
└───────────────────────────────────┼────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 UNIFIED LENDING PROVIDER ABSTRACTION                   │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                ILendingProvider Interface                      │   │
│   │  - checkEligibility()      - submitApplication()               │   │
│   │  - fetchOffers()           - acceptOffer()                     │   │
│   │  - pollStatus()            - generateKfsAndAgreement()         │   │
│   │  - verifyDisbursement()    - cancelApplication()               │   │
│   └───────────────────────┬───────────────┬────────────────────────┘   │
│                           │               │                            │
│           ┌───────────────┴────┐     ┌────┴────────────────┐           │
│           ▼                    ▼     ▼                     ▼           │
│   ┌───────────────┐   ┌───────────────┐   ┌────────────────────────┐   │
│   │  MockProvider │   │ FinBoxAdapter │   │  DirectLenderAdapter   │   │
│   │  (In-Memory)  │   │ (Aggregator)  │   │  (Future Direct NBFC)  │   │
│   └───────────────┘   └───────────────┘   └────────────────────────┘   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                RESPONSE NORMALIZERS & SECURITY GUARDS                  │
│                                                                        │
│   ┌───────────────────────────┐   ┌────────────────────────────────┐   │
│   │ Integer Paise Normalizer  │   │ Canonical Status Mapping       │   │
│   │ (BigInt Zero-Float Math)  │   │ (Aggregator -> Udhyam Machine) │   │
│   └───────────────────────────┘   └────────────────────────────────┘   │
│   ┌───────────────────────────┐   ┌────────────────────────────────┐   │
│   │ Payload Hasher & Redactor │   │ Fail-Closed Security Guard     │   │
│   │ (SHA-256 Forensic Hash)   │   │ (Never emit fake in Prod)      │   │
│   └───────────────────────────┘   └────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Unified Provider Interface Specification

The current `LenderAdapter` interface (`src/modules/lenders/lender-adapter.interface.ts`) is designed around simple single-attempt submissions. We propose extending it into a comprehensive `ILendingProvider` contract:

```typescript
// Proposed: src/modules/lenders/provider.interface.ts

export type ProviderMode = 'MOCK' | 'SANDBOX' | 'PRODUCTION';

export interface ProviderCustomerInfo {
  id: string;
  fullName: string;
  phone: string;
  // Optional / Transient for Server-to-Server journeys:
  pan?: string;
  dob?: string;
  pincode?: string;
}

export interface ProviderPurchaseInfo {
  id: string;
  amountPaise: bigint;
  productCategory: string;
  merchantLegalName: string;
  storeName: string;
}

export interface ProviderApplicationSubmission {
  applicationId: string;
  requestKey: string;
  customer: ProviderCustomerInfo;
  purchase: ProviderPurchaseInfo;
  requestedAmountPaise: bigint;
  requestedTenureMonths?: number | null;
  routingMode: 'SEQUENTIAL' | 'DISCOVERY';
  redirectUrl: string;
  webhookUrl: string;
}

export interface ProviderOfferProposal {
  providerOfferId: string;
  lenderCode: string;
  lenderDisplayName: string;
  principalPaise: bigint;
  downPaymentPaise?: bigint;
  tenureMonths: number;
  interestRatePercent: string;
  rateType: 'FIXED' | 'FLOATING' | 'FLAT' | 'REDUCING_BALANCE';
  aprPercent: string;
  emiPaise: bigint;
  processingFeePaise?: bigint;
  totalRepayablePaise?: bigint;
  termsUrl?: string;
  expiresAt?: Date;
}

export interface ProviderSubmissionResult {
  outcome: 'OFFERED' | 'DECLINED' | 'ADDITIONAL_INFO_REQUIRED' | 'PENDING' | 'UNAVAILABLE' | 'TIMEOUT';
  providerReference: string;
  embeddedJourneyUrl?: string; // Webview URL if customer must complete KYC/Mandate via Aggregator SDK
  offers?: ProviderOfferProposal[];
  requiredDocumentType?: string;
  errorCode?: string;
  safeResponseSummary?: Record<string, unknown>;
  latencyMs?: number;
}

export interface ILendingProvider {
  readonly providerId: string;
  readonly mode: ProviderMode;

  /** Initialize or verify provider connectivity */
  initialize(): Promise<void>;

  /** Preliminary eligibility check */
  checkEligibility(params: {
    customerPhone: string;
    amountPaise: bigint;
    productCategory: string;
  }): Promise<{ eligible: boolean; maxLimitPaise?: bigint; reason?: string }>;

  /** Submit application to underwriting / routing engine */
  submitApplication(params: ProviderApplicationSubmission): Promise<ProviderSubmissionResult>;

  /** Fetch latest offers for an in-flight application */
  fetchOffers(providerReference: string): Promise<ProviderOfferProposal[]>;

  /** Reserve / lock chosen offer */
  acceptOffer(params: {
    providerReference: string;
    providerOfferId: string;
    customerAcceptedAt: Date;
  }): Promise<{ success: boolean; nextStep: 'MANDATE' | 'AGREEMENT' | 'DISBURSEMENT_PENDING' }>;

  /** Query current loan lifecycle & disbursement status */
  pollStatus(providerReference: string): Promise<{
    status: string;
    disbursedAmountPaise?: bigint;
    utrNumber?: string;
    rawLenderStatus?: string;
  }>;

  /** Cancel in-flight application */
  cancelApplication(providerReference: string): Promise<boolean>;
}
```

---

## 3. Response Normalization & Forensic Auditing

Aggregator responses vary widely in field names, decimal formats, and error codes. The normalization pipeline enforces four guarantees:

### 1. Integer Paise Guarantee
All currency values from the aggregator (whether represented as float rupees `12500.50`, string `"12500.50"`, or integer paise) are converted into integer paise `BigInt`:
```typescript
export function toPaise(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    return BigInt(Math.round(value * 100));
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) throw new Error(`Invalid monetary amount: ${value}`);
    return BigInt(Math.round(parsed * 100));
  }
  throw new Error(`Unsupported currency type: ${typeof value}`);
}
```

### 2. Canonical Status Mapping
External aggregator statuses are strictly translated into Udhyam PAY state machine statuses:

| FinBox / Aggregator Status | Udhyam PAY Canonical Status | Transition Context |
| :--- | :--- | :--- |
| `INITIATED`, `PROCESSING`, `BUREAU_PULL` | `LENDER_PROCESSING` | `actor: SYSTEM` |
| `DOCS_REQUIRED`, `KYC_PENDING`, `AA_PENDING` | `ADDITIONAL_INFORMATION_REQUIRED` | `actor: LENDER`, `lenderConfirmed: true` |
| `OFFERS_READY`, `SANCTIONED` | `OFFER_AVAILABLE` | `actor: LENDER`, `lenderConfirmed: true` |
| `REJECTED`, `EXPIRED`, `UNSERVICEABLE` | `DECLINED` | `actor: LENDER`, `lenderConfirmed: true` |
| `MANDATE_SUCCESS`, `AGREEMENT_SIGNED` | `LENDER_FINAL_CONFIRMATION` | `actor: SYSTEM` |
| `DISBURSEMENT_IN_PROGRESS` | `DISBURSEMENT_PENDING` | `actor: LENDER`, `lenderConfirmed: true` |
| `DISBURSED`, `SETTLED` | `DISBURSED` | `actor: LENDER`, `lenderConfirmed: true` |
| `CANCELLED_BY_USER` | `CANCELLED` | `actor: MERCHANT_USER` or `SYSTEM` |

### 3. Forensic SHA-256 Payload Hashing
In accordance with DPDP compliance, **no raw payloads containing customer PII or identity documents are stored in the database**. Instead:
```typescript
const responseHash = createHash('sha256')
  .update(JSON.stringify(rawAggregatorPayload, serializeBigInts))
  .digest('hex');
```
The database stores only:
- `responseHash`: Cryptographic fingerprint for dispute resolution.
- `safeResponseSummary`: Non-sensitive JSON (offer counts, sanitized error codes, latency).

---

## 4. Multi-Environment Isolation & Fail-Closed Security

To ensure test data never contaminates production, the platform implements strict mode guards:

```typescript
// Mode resolution in src/config/env.ts:
PROVIDER_MODE: z.enum(['MOCK', 'SANDBOX', 'PRODUCTION']).default('MOCK');
```

### Critical Security Rules:
1. **Production Fail-Closed**: When `NODE_ENV === 'production'`, `PROVIDER_MODE` must NOT be `MOCK`. Attempting to start the server in production with `PROVIDER_MODE=MOCK` throws an immediate fatal exception:
   ```
   FatalError: PROVIDER_MODE cannot be MOCK in production. Real aggregator credentials required.
   ```
2. **Never Emit Simulated Offers in Production**: Mock adapters are stripped from the factory in production. Under no circumstance can a simulated lender proposal be saved as an authentic `FinancingOffer`.
3. **Server-Side Secret Isolation**: Aggregator API Keys, Client Secrets, and Webhook Signing Keys are strictly resolved server-side from environment variables (`FINBOX_API_KEY`, `FINBOX_SECRET_KEY`, `FINBOX_WEBHOOK_SECRET`). They are never bundled into client JavaScript or returned in API responses.

---

## 5. Database Schema Review & Recommendations

The current database schema (`prisma/schema.prisma`) was inspected against digital lending aggregator requirements. The schema is remarkably well-architected for core POS operations, but requires specific non-destructive enhancements to support live aggregator operations:

```
┌────────────────────────────────────────────────────────────────────────┐
│ EXISTING PRISMA SCHEMA EVALUATION                                      │
├────────────────────────────────────────────────┬───────────────────────┤
│ Capability Area                                │ Schema Assessment     │
├────────────────────────────────────────────────┼───────────────────────┤
│ Multi-tenant Merchant Isolation                │ EXCELLENT             │
│ Money Precision (Paise BigInt)                 │ EXCELLENT             │
│ Append-Only Audit & State Histories            │ EXCELLENT             │
│ Idempotent Purchases & Applications            │ EXCELLENT             │
│ Webhook Event Logging & Deduplication          │ EXCELLENT             │
│ Double-Entry Commission Ledger                 │ EXCELLENT             │
│ External Provider Reference Tracking           │ PARTIAL               │
│ Repayment Mandate Tracking                     │ MISSING               │
│ Loan Agreement & e-Sign Tracking               │ MISSING               │
│ Tokenized KYC Verification References          │ MISSING               │
└────────────────────────────────────────────────┴───────────────────────┘
```

### Detailed Schema Recommendations (Non-Destructive):

#### Recommendation 1: Provider References on `lender_applications`
*Current*: `externalReference` stores a single lender string.  
*Need*: When integrating via an aggregator, there are two distinct references:
1. `aggregatorApplicationId`: The session ID generated by the aggregator (e.g. FinBox).
2. `lenderLoanId`: The underlying NBFC's loan account number.  
*Recommended Change*:
```prisma
model LenderApplication {
  // Existing fields ...
  providerCode            String?   @default("DIRECT") // "FINBOX", "SETU", etc.
  aggregatorReference     String?   // Aggregator tracking UUID
  externalReference       String?   // Underlying NBFC reference
  embeddedJourneyUrl      String?   // Hosted SDK URL for customer KYC/mandate
  // ...
  @@index([aggregatorReference])
}
```

#### Recommendation 2: Repayment Mandate Tracking (`mandates` table)
*Current*: No mandate representation exists in the schema.  
*Need*: Regulated lenders require a valid e-NACH or UPI Autopay mandate before sanctioning loan disbursement.  
*Recommended Change (New Table)*:
```prisma
enum MandateType {
  E_NACH_NETBANKING
  E_NACH_DEBIT_CARD
  UPI_AUTOPAY
  PHYSICAL_NACH
}

enum MandateStatus {
  INITIATED
  AUTHENTICATED
  ACTIVE
  REJECTED
  REVOKED
}

model Mandate {
  id                    String        @id @default(uuid()) @db.Uuid
  applicationId         String        @db.Uuid
  merchantId            String        @db.Uuid
  mandateType           MandateType
  status                MandateStatus @default(INITIATED)
  umrn                  String?       // NPCI Unique Mandate Reference Number
  maxDebitAmountPaise   BigInt
  bankName              String?
  maskedAccountNumber   String?       // e.g. "XXXX1234" (no raw account number)
  authorizedAt          DateTime?     @db.Timestamptz(3)
  createdAt             DateTime      @default(now()) @db.Timestamptz(3)
  updatedAt             DateTime      @updatedAt @db.Timestamptz(3)

  application FinancingApplication @relation(fields: [applicationId], references: [id])
  merchant    Merchant             @relation(fields: [merchantId], references: [id])

  @@index([applicationId])
  @@map("mandates")
}
```

#### Recommendation 3: Loan Agreement & e-Sign Tracking (`loan_agreements` table)
*Current*: `FinancingOffer` only has a text column `termsUrl`.  
*Need*: Under RBI rules, a Key Fact Statement (KFS) and signed agreement copy must be retained with audit logs.  
*Recommended Change (New Table)*:
```prisma
enum AgreementStatus {
  GENERATED
  KFS_ACCEPTED
  ESIGN_PENDING
  SIGNED
  EXPIRED
}

model LoanAgreement {
  id                    String          @id @default(uuid()) @db.Uuid
  applicationId         String          @db.Uuid
  offerId               String          @db.Uuid
  status                AgreementStatus @default(GENERATED)
  kfsVersion            String          @default("v1.0")
  agreementUrl          String?         // Expiring signed URL to secure document vault
  documentHash          String?         // SHA-256 of the un-signed PDF
  signedDocumentHash    String?         // SHA-256 of the e-Signed PDF
  eSignProvider         String?         // "DIGIO", "LEGALITY", "FINBOX_ESIGN"
  eSignReference        String?         // Transaction ID from signature gateway
  signedAt              DateTime?       @db.Timestamptz(3)
  createdAt             DateTime        @default(now()) @db.Timestamptz(3)

  application FinancingApplication @relation(fields: [applicationId], references: [id])
  offer       FinancingOffer       @relation(fields: [offerId], references: [id])

  @@index([applicationId])
  @@map("loan_agreements")
}
```

---

## 6. Testing & Failure Handling Strategy

Testing external fintech integrations requires distinct test environments to prevent false positives and unmonitored failures:

### 1. Test Layer Classification

| Test Layer | Execution Scope | Network Calls | Fixtures & Credentials | Command |
| :--- | :--- | :--- | :--- | :--- |
| **Unit Tests** | Adapter logic, EMI math, state transitions | Isolated (No network) | In-memory mocks | `npm test tests/unit` |
| **Contract Tests** | Validating Aggregator JSON serialization & parsing | Isolated (No network) | Recorded JSON wire fixtures from vendor | `npm test tests/contract` |
| **Sandbox Integration Tests** | Full handshake against vendor sandbox API | Active Network | Sandbox API keys & test phone numbers | `npm run test:sandbox` |
| **Synthetic Smoke Tests** | Health check, credential readiness, latency ping | Outbound ping | Staging / Prod monitoring token | `npm run test:smoke` |

### 2. Mandatory Failure Scenarios to Test

The integration test suite must explicitly cover the following 12 failure modes:

1. **Aggregator Handshake Timeout**: Aggregator takes > 10,000ms to respond. Circuit breaker must trip to OPEN, and waterfall must fail gracefully to secondary provider.
2. **Lender Hard Decline**: Adverse credit policy decline (`CREDIT_SCORE_LOW`). Application transitions cleanly to `DECLINED` with customer-facing reason.
3. **Partial Discovery Result**: 3 partner lenders queried; 1 succeeds, 1 times out, 1 returns 503. The orchestrator must present the single valid offer without throwing a 500 error.
4. **Duplicate Webhook Delivery**: Aggregator delivers the identical `LOAN_DISBURSED` webhook twice. First call processes and accrues commission; second call returns HTTP 200 with `duplicate: true`, causing zero duplicate ledger entries.
5. **Out-of-Order Webhook Delivery**: `LOAN_DISBURSED` arrives before `CUSTOMER_ACCEPTED_OFFER` is recorded. System flags event as `IGNORED_OUT_OF_ORDER` and alerts operations.
6. **Invalid Webhook HMAC Signature**: Attacker sends forged webhook. `WebhookService` rejects with HTTP 401 and logs `REJECTED_INVALID_SIGNATURE`.
7. **Rate Limiting (HTTP 429)**: Aggregator returns 429 with `Retry-After: 60`. Client backs off exponentially without crashing.
8. **Malformed / HTML Response**: Gateway returns `502 Bad Gateway` with HTML body. Normalizer catches `SyntaxError` and classifies outcome as `MALFORMED_RESPONSE`.
9. **Zero Offers Available**: Application passes preliminary check, but all partner NBFCs decline. Application marks terminal state `DECLINED` with reason recorded.
10. **Expired Checkout Session**: Customer scans QR code after 30 minutes. API returns 409 `Checkout session has expired` and prevents application creation.
11. **Concurrent Offer Acceptance**: Two requests simultaneously accept different offers. Optimistic version locking on `FinancingApplication` allows only the first to succeed.
12. **Idempotent Re-Submission**: Network drop during submission retry. Same `requestKey` returns existing `LenderApplication` attempt.

---

## 7. 5-Stage Implementation Roadmap

```
Stage 1: Abstraction Refactoring & In-Memory Contracts (Weeks 1–2)
├── Define ILendingProvider interface & data contracts
├── Refactor WaterfallOrchestrator to depend on ILendingProvider
├── Move MockLenderAdapter to implement ILendingProvider
└── Add recorded vendor fixture tests (100% test coverage)

Stage 2: Aggregator Sandbox Client & Authentication (Weeks 3–4)
├── Receive FinBox / Aggregator sandbox credentials
├── Implement FinBoxProvider client with axios / native fetch
├── Wire mTLS, API Key, and request signing middleware
└── Validate sandbox health & pre-qualification endpoints

Stage 3: Customer Journey & Webview / SDK Integration (Weeks 5–6)
├── Wire Aggregator Embedded Journey URL into Checkout API
├── Build mobile checkout redirect handler for KYC and Mandate
├── Implement unified Aggregator Webhook receiver
└── Map aggregator underwriting callbacks to Udhyam state machine

Stage 4: Closing, Mandate & Disbursement Reconciliation (Weeks 7–8)
├── Implement Mandate and LoanAgreement database models
├── Connect KFS presentation and e-Sign completion hooks
├── Validate bank UTR reconciliation against ledger disbursements
└── Perform end-to-end sandbox walkthrough with test merchants

Stage 5: Security Hardening, VAPT & Production Pilot (Weeks 9–10)
├── Third-party application VAPT security audit
├── Formalize tripartite LSP agreement with partner NBFCs
├── Configure production KMS secrets and environment variables
└── Pilot deployment with 5 selected retail merchant stores
```

