# Udhyam PAY — Mock JSON Providers Implementation Plan

**Date**: November 2026  
**Status**: Ready for Implementation  
**Audience**: Backend Engineers, Systems Architects  
**Goal**: Implement comprehensive JSON-based mock provider responses and environment safety controls while preserving existing production-grade architecture.

---

## 1. Inspection Findings & Current State

Based on the inspection of `docs/integration-readiness/`, `src/`, `prisma/`, and `tests/`:

1. **Existing Architecture is Production-Grade**:
   - Multi-tenant merchant isolation (`merchantId`), RBAC, token rotation with reuse detection, and 15-state application machine are verified by 112 Vitest tests and 19 verify-logic checks.
   - Monetary math is strictly integer paise (`BigInt`) with zero IEEE 754 float drift.
   - Double-entry commission accounting and HMAC SHA-256 webhook processing are fully verified.
2. **Current Mock Provider Gap**:
   - `MockLenderAdapter` generates programmatic responses with hardcoded rates and tenures.
   - No structured JSON fixtures exist.
   - No explicit `PROVIDER_MODE` (`mock`, `sandbox`, `production`) exists in `src/config/env.ts`.
   - Production does not have a fail-closed guard preventing accidental mock fallback.
   - Demo lenders are limited to two hardcoded entries (`LENDER_ALPHA`, `LENDER_BETA`).

---

## 2. Implementation Strategy & Architecture

```
                               src/config/env.ts
                                      │
                                      ▼
                        PROVIDER_MODE: mock | sandbox | production
                                      │
                        ┌─────────────┴─────────────┐
                        │                           │
                   (mode = mock)              (mode = production)
                        │                           │
                        ▼                           ▼
            loadAndValidateFixtures()      Check Aggregator Secrets
                        │                           │
          ┌─────────────┼─────────────┐             ├── Missing: Throw Safe Config Error
          ▼             ▼             ▼             └── Configured: Initialize Real Client
    demo-lenders   eligibility    scenarios
        .json         .json         .json
          │             │             │
          └─────────────┬─────────────┘
                        │
                        ▼
             JsonMockLenderAdapter
          (Implements LenderAdapter)
                        │
                        ▼
              WaterfallOrchestrator
```

---

## 3. Ordered Phases of Execution

### Phase 2: Mock Provider JSON Fixtures & Adapter
1. Create `src/modules/lenders/fixtures/`:
   - `demo-lenders.json`: Definitions of 3 demo lenders (`DEMO_BANK_ALPHA`, `DEMO_NBFC_BETA`, `DEMO_GAMMA_CREDIT`) with simulated rates, limits, and categories.
   - `eligibility-rules.json`: Tiered eligibility thresholds, credit policy rules, and category constraints.
   - `scenario-fixtures.json`: Deterministic scenario definitions (`APPROVE`, `PROMOTIONAL_ZERO_EMI`, `NO_OFFERS`, `DECLINE`, `INELIGIBLE`, `ADDITIONAL_INFO`, `TIMEOUT`, `UNAVAILABLE`, `RATE_LIMITED`, `MALFORMED`, `ASYNC`).
2. Create `src/modules/lenders/fixtures/fixture-schema.ts`:
   - Zod schemas validating all fixture JSON structures at boot time.
   - `loadAndValidateFixtures()` ensuring corrupted fixtures fail fast with clear errors.
3. Enhance `src/modules/lenders/adapters/json-mock-lender.ts` and `mock-lender.ts`:
   - Support JSON-backed demo lenders.
   - Normalize fixture proposals into internal `OfferProposal` structures.
   - Mark all demo offers with `isSimulated: true`.
   - Maintain 100% backward compatibility with `MockLenderAdapter({ code, displayName, ... })`.

### Phase 3: Configuration & Environment Safety
1. Update `src/config/env.ts`:
   - Add `PROVIDER_MODE: z.enum(['mock', 'sandbox', 'production']).optional()`.
   - Enforce: If `NODE_ENV === 'production'` and `PROVIDER_MODE === 'mock'`, throw `EnvValidationError`.
   - Add optional aggregator config keys (`AGGREGATOR_BASE_URL`, `AGGREGATOR_API_KEY`, `AGGREGATOR_CLIENT_SECRET`, `AGGREGATOR_WEBHOOK_SECRET`).
2. Create `src/modules/lenders/provider-factory.ts`:
   - Factory `createLenderAdapters(config)` returning active adapters.
   - Fails safely if `PROVIDER_MODE === 'production'` and genuine credentials are not provided.
3. Wire `src/server.ts` to use `createLenderAdapters(config)`.

### Phase 4: Database & State Machine Invariants
- Zero changes to Prisma schema or migrations.
- Database remains the sole authority for persistent state.
- Preserves integer-paise math, tenant isolation, and optimistic concurrency.

### Phase 5 & 6: Testing & Verification
1. Unit tests in `tests/unit/mock-provider.test.ts` covering:
   - Multi-offer generation across demo lenders.
   - Zero-EMI promotional offers.
   - Ineligible and decline scenarios.
   - Provider timeouts, 503 unavailability, rate limits.
   - Malformed fixture detection.
   - Production mode fail-closed checks.
   - Missing credentials handling.
2. Ensure full suite passes:
   - `npm run typecheck`
   - `npm run test:verify`
   - `npm test`
   - `npm run build`

