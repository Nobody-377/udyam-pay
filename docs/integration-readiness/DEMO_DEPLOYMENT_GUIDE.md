# Udyam PAY — Demo Deployment Guide

**Document Reference**: `docs/integration-readiness/DEMO_DEPLOYMENT_GUIDE.md`  
**Target Environment**: Demo / Staging / Investor Presentation Environment  
**Mode**: Mock JSON Provider Mode (`PROVIDER_MODE=mock`)  
**Audience**: Backend Engineers, DevOps / Infrastructure Engineers, Solutions Architects  

---

## 1. Overview & Architecture Boundary

This guide provides instructions for deploying Udyam PAY in a controlled, isolated **Demo Mode**. 

In Demo Mode:
- **Simulated Lenders**: Three mock lenders (`[DEMO] Alpha Digital Bank`, `[DEMO] Beta Retail Finance NBFC`, `[DEMO] Gamma Consumer Credit`) provide realistic credit evaluation, waterfall routing, and offer generation without connecting to external banking APIs.
- **Explicit Demo Labeling**: Every lender record carries `isSimulated: true` and a `[DEMO]` prefix. Every generated offer carries `isSimulated: true` and links to demonstration terms.
- **Fail-Closed Security**: Production environments (`NODE_ENV=production`) reject `PROVIDER_MODE=mock` at startup. Demo configuration must remain strictly isolated from production environments.
- **Full Domain Capabilities**: Merchant onboarding, shops, customer DPDP consent, QR checkout sessions, integer-paise EMI calculations, double-entry commission accounting, and status auditing are 100% active.

---

## 2. Infrastructure Prerequisites

| Component | Minimum Version | Notes |
| :--- | :--- | :--- |
| **Node.js** | `>= 20.19.0` | Node.js runtime supporting ESM and top-level await. |
| **npm** | `>= 10.0.0` | Standard package manager. |
| **PostgreSQL** | `16.x` | Managed PostgreSQL database (Cloud SQL, Supabase, Neon, or local/Docker container). |
| **Network Access** | Inbound HTTP(S) | Port 3000 (configurable via `PORT`). No outbound internet access is required by the backend in demo mode. |

---

## 3. Environment Variables Specification

Create a dedicated environment file (e.g. `.env.demo`) for your demo instance. 
> [!IMPORTANT]
> Never commit `.env` or files containing real secrets to source control. All values below are **placeholders** for demonstration deployment.

```bash
# ==============================================================================
# UDYAM PAY — DEMO ENVIRONMENT CONFIGURATION (.env)
# ==============================================================================

# --- Node & Provider Mode ----------------------------------------------------
# Use 'development' for demo deployments so mock providers are permitted.
NODE_ENV=development

# Explicitly set to 'mock' to load JSON-backed demonstration lenders.
PROVIDER_MODE=mock

# Server listener port
PORT=3000

# --- Logging & Diagnostics ---------------------------------------------------
# Options: fatal | error | warn | info | debug | trace | silent
LOG_LEVEL=info

# Set to false for standard structured JSON output (recommended for cloud logs)
LOG_PRETTY=false

# Number of reverse proxy hops to trust (1 if behind Nginx/ALB/Cloudflare)
TRUST_PROXY=0

# --- Browser CORS Hardening --------------------------------------------------
# Comma-separated list of EXACT allowed frontend origins.
# NO wildcards (*), NO paths, and NO trailing slashes are permitted.
# Example: https://demo.udyam.example,http://localhost:5173
CORS_ALLOWED_ORIGINS=https://demo.udyam.example,http://localhost:5173

# Request payload ceiling and global rate limits
REQUEST_BODY_LIMIT=100kb
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=300

# --- Security & Authentication ----------------------------------------------
# Minimum 32-character high-entropy cryptographic secret for HMAC-SHA256 signing
JWT_SECRET=replace-with-at-least-32-chars-crypto-secret-key-in-prod
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY_DAYS=30

# Webhook signature tolerance in seconds
WEBHOOK_DEFAULT_TOLERANCE_SECONDS=300

# Development-only webhook fallback secret (strictly forbidden in production)
DEV_DEFAULT_WEBHOOK_SECRET=demo-webhook-secret-min-16-chars

# Individual demo lender webhook secrets (referenced in database configurations)
LENDER_ALPHA_WEBHOOK_SECRET=demo-alpha-secret-key-32chars-min!
LENDER_BETA_WEBHOOK_SECRET=demo-beta-secret-key-32chars-min!

# --- PostgreSQL Connection ---------------------------------------------------
# PostgreSQL connection string with public schema. URL-encode special characters.
DATABASE_URL=postgresql://demo_user:demo_password@postgres-host:5432/udyam_demo?schema=public
```

---

## 4. Database Setup & Demo Seeding

### Step 4.1: Deploy Database Migrations

Apply the existing migrations to the demo database without resetting or dropping data:

```bash
# Generates Prisma client types
npm run prisma:generate

# Applies all pending migrations up to current version
npm run prisma:migrate:deploy
```

### Step 4.2: Seed Demo Lenders and Entities

To allow the waterfall orchestrator to discover active lenders in the database, run the idempotent demo seeder:

```bash
npm run seed:demo
```

**What the demo seeder performs:**
1. **Verifies Environment Safety**: Ensures `NODE_ENV !== 'production'` (or requires `ALLOW_DEMO_SEED=true` override) to prevent accidental execution in production databases.
2. **Upserts 3 Demo Lenders**:
   - `DEMO_BANK_ALPHA` (`[DEMO] Alpha Digital Bank`) — Type: `BANK`, Range: ₹5,000 to ₹5,00,000, Categories: Smartphone, Laptop, TV, AC.
   - `DEMO_NBFC_BETA` (`[DEMO] Beta Retail Finance NBFC`) — Type: `NBFC`, Range: ₹1,000 to ₹3,00,000, Categories: Electronics, Appliances.
   - `DEMO_GAMMA_CREDIT` (`[DEMO] Gamma Consumer Credit`) — Type: `NBFC`, Range: ₹500 to ₹1,50,000, Categories: Smartphone, Other Electronics.
   - (Includes legacy aliases `LENDER_ALPHA` and `LENDER_BETA` for backward compatibility).
3. **Upserts Lender Configurations**: Enables all demo lenders and sets sequential priority rankings.
4. **Seeds Sample Demo Merchant & Shop**:
   - Merchant: `Apex Digital Retail Private Limited` (`Apex Electronics`)
   - Merchant Owner Login: `owner@apex.example` / `ApexOwner2026!`
   - Flagship Shop: `Apex Flagship Store Indiranagar` (Bengaluru, Karnataka)
   - System Admin: `admin@udyam.example` / `AdminPassword123!`
5. **Preserves Immutability & Financial Records**: Uses safe `upsert` queries; never drops, truncates, or modifies existing transactions, applications, or commission ledger entries. Rerunning `npm run seed:demo` is 100% idempotent.

---

## 5. Server Startup

### Supported Startup Commands

Because Node.js native ESM loader requires explicit file extensions (`./app.js`) for relative imports, starting TypeScript ESM projects without a bundler relies on `tsx` for extensionless specifier resolution.

#### For Demo Deployment (Recommended)
```bash
npm run start:demo
```
This executes `tsx src/server.ts`, which loads TypeScript sources directly, enforces environment schemas, and binds to the configured `PORT`. `tsx` is included in project `dependencies` so it remains available in container builds.

#### For Development with Hot Reload
```bash
npm run dev
```
Runs `tsx watch src/server.ts` for automated reloading during local development.

#### Standard Build Check
```bash
npm run build
```
Compiles TypeScript sources to `dist/` via `tsc -p tsconfig.build.json`.

---

## 6. CORS Configuration & Frontend Connectivity

The CORS policy in `src/app.ts` is strictly origin-checked against the `CORS_ALLOWED_ORIGINS` environment variable:

```ts
// How CORS is enforced
const allowedOrigins = new Set(config.CORS_ALLOWED_ORIGINS);
app.use(
  cors({
    origin: (origin, callback) => {
      // Requests without Origin header (curl, mobile apps) are permitted
      callback(null, origin === undefined || allowedOrigins.has(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    credentials: false,
    maxAge: 600,
  }),
);
```

### CORS Configuration Rules
1. **Exact Matches Only**:
   - Valid: `https://demo.udyam.example,http://localhost:5173`
   - Invalid: `https://demo.udyam.example/` (trailing slash rejected by Zod schema)
   - Invalid: `*.udyam.example` (wildcard subdomains rejected by Zod schema)
   - Invalid: `*` (universal wildcard rejected by Zod schema)
2. **Credentials**: `credentials: false` is enforced. Authentication relies on standard `Authorization: Bearer <token>` headers, not ambient browser cookies.
3. **Preflight Caching**: HTTP `OPTIONS` preflight responses are cached for 600 seconds (`maxAge: 600`).

---

## 7. Verification & Health Probes

### Verification Suite Commands

Run the complete verification pipeline to validate the demo deployment:

| Check | Command | Expected Output | Purpose |
| :--- | :--- | :--- | :--- |
| **Static Type Check** | `npm run typecheck` | `tsc --noEmit` exits 0 | Confirms zero TypeScript type errors. |
| **Full Test Suite** | `npm test` | 15 test files passed, 151/151 tests passed | Runs unit, integration, and e2e test suites. |
| **Logic Verification** | `npm run test:verify` | 19/19 checks passed | Asserts state machines, token rotation, and financial math. |
| **Customer Journey Simulation** | `npx tsx scripts/verify-journey.ts` | 14/14 steps completed | Tests full lifecycle: merchant login, QR scan, waterfall, and offer acceptance. |

### Health & Readiness Probes

The backend exposes two probe endpoints:

1. **Liveness Probe**:
   ```bash
   curl -i http://localhost:3000/health
   ```
   **Expected Response (HTTP 200)**:
   ```json
   {
     "status": "ok"
   }
   ```
   Headers include `X-Request-Id` and `X-Content-Type-Options: nosniff`.

2. **Readiness Probe**:
   ```bash
   curl -i http://localhost:3000/ready
   ```
   **Expected Response (HTTP 200)**:
   ```json
   {
     "status": "ready"
   }
   ```
   Verifies database connectivity (`SELECT 1`). If the database connection fails, returns `HTTP 503` (`{"status": "unavailable"}`) without leaking database credentials or connection strings.

---

## 8. Keeping Demo and Production Environments Strictly Separate

To prevent accidental mock data contamination or security breaches:

1. **Production Guard Rejection**:
   - Setting `NODE_ENV=production` together with `PROVIDER_MODE=mock` will cause the server to fail at boot:
     ```
     Invalid environment configuration:
       - PROVIDER_MODE: PROVIDER_MODE must not be "mock" in production. Production mode must never silently fall back to mock offers.
     ```
2. **Database Isolation**:
   - Never share database instances or schemas between demo and production.
   - Demo databases should be prefixed or isolated (e.g. `udyam_demo`).
   - The demo seed script explicitly refuses to run when `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true` is passed.
3. **No Real Credential Exposure**:
   - Demo environments must never contain real aggregator credentials, payment gateway keys, or live SMS/email OTP gateway secrets.
4. **Mock Offer Disclaimers**:
   - All demo responses include `isSimulated: true`. Frontend UI components must render visible demo badges (e.g. `[DEMO MODE: SIMULATED CREDIT OFFER]`) for compliance.

---

## 9. Known Limitations for Demo Mode

1. **Simulated Lending Decisions**:
   - Offers, interest rates, and eligibility determinations are generated from JSON fixtures (`demo-lenders.json`, `scenario-fixtures.json`).
   - Phone numbers ending in `0001` trigger approvals; `0002` triggers declines; other numbers fall back to deterministic default scoring.
2. **Absence of Real Digital KYC**:
   - No live Aadhaar e-KYC, DigiLocker, or CKYC integration exists in demo mode.
3. **Absence of Real Banking Rails**:
   - No live bank account penny drop, UPI Autopay mandate, or e-NACH mandate registration is executed.
4. **Absence of Tripartite Regulatory Agreements**:
   - Real lending in India requires executed Lending Service Provider (LSP) tripartite agreements under RBI guidelines. Demo mode operates strictly for presentation and testing.

