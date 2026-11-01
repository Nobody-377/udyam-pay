# Udhyam PAY Backend

Backend for **Udhyam PAY**, a B2B2C multi-lender EMI financing platform for offline retailers in India.
Udhyam PAY is a technology and financing-distribution platform, **not a lender**: credit decisions,
loan agreements, and disbursements remain exclusively with authorized lending partners (Banks & NBFCs).

---

## Architecture & Technology Stack

- **Runtime & Language:** Node.js 22 LTS, TypeScript 5 (ES2022 / ESM modular monolith)
- **Framework:** Express 5.1 with Helmet, CORS, Rate Limiting, and Pino structured logging
- **Database & ORM:** PostgreSQL 16 with Prisma 6
- **Financial Arithmetic:** Strict integer paise (`BigInt` / zero floating-point currency calculations)
- **Security & Cryptography:** Argon2id password hashing (with scrypt fallback), HS256 JWT, HMAC SHA-256 webhook signatures, constant-time comparisons, token rotation with reuse detection
- **Documentation:** OpenAPI 3.1.0 specification mounted at `/docs` and `/api/docs`

---

## Domain Modules & Key Capabilities

1. **Authentication & Authorization (`src/modules/auth`):**
   - Argon2id password hashing with automatic cryptographically secure `scrypt` fallback.
   - Access tokens (JWT HS256) and cryptographically unguessable refresh token families.
   - Refresh token rotation with immediate reuse/theft detection and family revocation.
   - Account lockout: 5 consecutive failed login attempts trigger a 15-minute lockout.
   - Role-Based Access Control (`SYSTEM_ADMIN`, `OPS_AGENT`, `MERCHANT_OWNER`, `MERCHANT_STAFF`).
   - Merchant status verification middleware (`VERIFIED` / `ACTIVE` checks).

2. **Persistence & Stores (`src/modules/persistence`):**
   - `stores.ts`: 13 domain repository interfaces.
   - `in-memory-store.ts`: Complete in-memory implementation for isolated unit testing without a database.
   - `prisma-store.ts`: PostgreSQL persistence layer implementing transactions and optimistic version locking.

3. **Merchants & Shops (`src/modules/merchants`):**
   - Merchant onboarding, KYC verification status, suspension controls, and shop management.

4. **Customers & DPDP Compliance (`src/modules/customers`):**
   - Customer profile management with explicit purpose-based consent records.
   - Full support for the Digital Personal Data Protection (DPDP) Act: consent revocation and cryptographic customer anonymization (right to be forgotten).

5. **Purchases & Idempotency (`src/modules/purchases`):**
   - Retail purchase record creation with strict `idempotencyKey` + `@@unique([merchantId, idempotencyKey])`.

6. **Checkout Sessions & QR (`src/modules/checkout`):**
   - Unguessable `cs_` session tokens stored as SHA-256 hashes.
   - Atomic single-use consumption and expiration handling.
   - Generates signed QR payloads for in-store point-of-sale scanning.

7. **Lenders, EMI Engine & Circuit Breaker (`src/modules/lenders`):**
   - `emi-calculator.ts`: Exact integer paise reducing balance, flat, and 0% promotional EMI calculations with zero lost paise in amortization schedules.
   - `circuit-breaker.ts`: Closed, Open, and Half-Open failure threshold management per lender.
   - `MockLenderAdapter`: Deterministic simulation of 8 scenarios (Approve, Decline, Timeout, 503 Unavailability, Async, Malformed Payload, etc.).

8. **Waterfall Orchestrator & State Machine (`src/modules/orchestration`, `src/modules/applications`):**
   - `waterfall.ts`: Sequential priority routing with fallback on decline and parallel discovery mode.
   - `result-applier.ts`: Validates and translates lender responses into state machine transitions.
   - 15-status finite state machine enforcing valid transitions and requiring explicit lender authority for credit outcomes.
   - Enforces the database invariant of **at most one active application per purchase**.

9. **Offers Management (`src/modules/offers`):**
   - Normalization of lender offers, customer offer selection/acceptance, and atomic cancellation of competing offers.

10. **Webhooks & Ingestion (`src/modules/webhooks`):**
    - Secure lender webhook endpoint (`/api/v1/webhooks/lenders/:code`).
    - HMAC SHA-256 signature verification and 300-second timestamp tolerance replay protection.
    - Idempotent event de-duplication and automatic transition to `DISBURSED` status upon confirmed loan disbursement.

11. **Financial Commission Ledger (`src/modules/ledger`):**
    - Double-entry commission accounting on confirmed disbursements.
    - Guaranteed single accrual per transaction and unique reversal per entry enforced both in application code and via PostgreSQL partial unique indexes.

12. **Admin Operations & Background Workers (`src/modules/admin`, `src/modules/workers`):**
    - Merchant approval/suspension APIs, lender configuration routing overrides, and manual review escalation resolution.
    - Background workers for expiring stale checkout sessions and anonymizing expired DPDP customer data.

---

## Database Constraints, Migration & Append-Only Triggers

Prisma cannot natively declare PostgreSQL check constraints or triggers in `schema.prisma`. All relational integrity rules and the complete baseline DDL are defined in [`prisma/migrations/20261031120000_init/migration.sql`](./prisma/migrations/20261031120000_init/migration.sql):
- **Schema Scale:** 23 enums and 19 tables.
- **Monetary Validity:** `CHECK ("amountPaise" > 0)` and non-negative constraints on all fees and loan amounts.
- **Active Application Exclusivity:** Partial unique index `WHERE "status" NOT IN ('DECLINED', 'DISBURSED', 'CANCELLED', 'EXPIRED')` ensuring at most one active application exists per purchase.
- **Commission Ledger Invariants:** Partial unique index preventing duplicate accruals for the same transaction, and partial unique index preventing duplicate reversals of an accrual entry.
- **Append-Only Immutability:** Triggers forbidding `UPDATE` and `DELETE` on `application_status_history`, `audit_logs`, `commission_entries`, and `disbursement_statuses`.

### Migration Adoption Procedure
- **Clean / Fresh Deployment:** Run `npx prisma migrate deploy` to apply the complete baseline migration and triggers.
- **Existing Database with Pre-existing Tables:** Run `npx prisma migrate resolve --applied 20261031120000_init` to mark the baseline as recorded without destructive schema re-creation.

---

## Verification & Testing

### 1. Offline Logic Verification Suite (Runs Out-of-the-Box)

To verify the core business logic, state machines, and calculations on Node 22 without requiring third-party test runners:
```bash
npm run test:verify
# or
node scripts/run-verify.js
```
This executes **19 tests across 12 suites** covering:
- Application state machine terminal state isolation and lender authority checks.
- Cryptographic password hashing, JWT signing, token rotation, and reuse/theft detection.
- Production JWT security: explicit valid secret requirement, rejection of dev defaults.
- Exact integer paise reducing balance amortization (zero lost paise).
- Circuit breaker state tripping and probe recovery.
- Deterministic mock lenders (approval, decline, timeout, 503).
- Sequential waterfall fallback orchestration.
- One-active-application-per-purchase concurrency guarantee.
- Unguessable QR token generation and atomic consumption.
- Webhook HMAC SHA-256 signature verification and de-duplication.
- Financial commission ledger single accrual and unique reversal constraints.
- Expiration worker background sweeping with state machine transitions.
- Full 15-step end-to-end lifecycle flow with DPDP anonymization.

### 2. Full Project Typecheck & Production Build

To typecheck and build the entire project:
```bash
npm run typecheck
npm run build
```

### 3. Full Vitest & Integration Test Suites

To run the complete automated test suite (112 tests across 13 test files):
```bash
# Run all tests
npm test

# Run all unit tests
npm run test:unit

# Run HTTP integration tests
npm run test:integration

# Run end-to-end full lifecycle flow test
npm run test:e2e
```

---

## Local Setup & Development

### 1. Prerequisites
- Node.js 20.19+ (Node 22 LTS recommended)
- npm 10+
- PostgreSQL 16 (or Docker Compose)

### 2. Getting Started
```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env to set DATABASE_URL and JWT_SECRET (min 32 characters)

# 3. Start PostgreSQL container
npm run db:up

# 4. Generate Prisma client & apply migrations
npm run prisma:generate
npm run prisma:migrate:dev

# 5. Apply custom SQL constraints and triggers
# Linux / macOS:
cat prisma/sql/001_constraints.sql | psql $DATABASE_URL
# Windows PowerShell:
# Get-Content prisma/sql/001_constraints.sql | psql $DATABASE_URL

# 6. Seed initial mock lenders and system administrator
npm run prisma:seed
# Or create an admin user manually:
# npx tsx scripts/create-admin.ts admin@udhyampay.com StrongAdminPass123!

# 7. Start the development server
npm run dev
```

### 3. API Documentation
Once running, interactive OpenAPI documentation is available at:
- `http://localhost:3000/docs`
- `http://localhost:3000/api/docs`
- Raw specification: `http://localhost:3000/api/v1/openapi.json`

---

## Project Structure

```
udhyam-pay-backend/
├── prisma/
│   ├── schema.prisma               # Prisma domain models, enums & relations
│   ├── seed.ts                     # Database seed script for mock lenders & admin
│   └── sql/001_constraints.sql     # CHECK constraints, append-only triggers & partial indexes
├── src/
│   ├── app.ts                      # Express app factory with middleware & docs
│   ├── server.ts                   # Process lifecycle, graceful shutdown & service wiring
│   ├── config/                     # Environment validation (Zod) & Pino logger
│   ├── common/                     # Common errors, HTTP envelopes & pagination
│   ├── docs/                       # OpenAPI 3.1.0 specification
│   ├── routes/                     # Central API router (/api/v1)
│   ├── types/                      # Ambient declarations for offline typechecking
│   └── modules/
│       ├── admin/                  # Merchant verification, lender config, manual review
│       ├── applications/           # Lifecycle, state machine & 15-status engine
│       ├── auth/                   # Argon2id, JWT, token rotation, lockout & RBAC
│       ├── checkout/               # Checkout sessions, SHA-256 tokens & QR codes
│       ├── customers/              # Customers, DPDP consents & anonymization
│       ├── health/                 # /health and /ready probes
│       ├── ledger/                 # Double-entry commission accounting
│       ├── lenders/                # EMI calculator, circuit breaker, mock lenders
│       ├── merchants/              # Merchants, shops & staff management
│       ├── offers/                 # Offer listing, comparison & acceptance
│       ├── orchestration/          # Waterfall engine (sequential/discovery) & result applier
│       ├── persistence/            # Store interfaces, InMemoryStore & PrismaStore
│       ├── purchases/              # Retail purchases & idempotency keys
│       ├── webhooks/               # HMAC SHA-256 webhook ingestion & deduplication
│       └── workers/                # Expiration sweeps & DPDP retention worker
├── tests/
│   ├── unit/                       # 10 unit test suites covering all modules
│   ├── integration/                # Express HTTP route tests
│   ├── e2e/                        # End-to-end full financing lifecycle test
│   └── helpers/                    # Test app builders & dependency injection harnesses
├── scripts/
│   ├── create-admin.ts             # Admin user provisioning CLI
│   ├── run-verify.js               # Offline Node.js test runner harness
│   └── verify-logic.ts             # 13 comprehensive logic verification test suites
├── AUDIT_REPORT.md                 # Detailed initial audit report
├── IMPLEMENTATION_PLAN.md          # 12-phase test-driven implementation plan
├── STATUS.md                       # Real-time implementation & verification status
└── package.json                    # Project configuration, scripts & dependencies
```

---

## License

Proprietary and Confidential. All rights reserved.
