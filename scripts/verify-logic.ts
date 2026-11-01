import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { evaluateTransition } from '../src/modules/applications/application-state-machine';
import { APPLICATION_STATUSES, TERMINAL_STATUSES, isTerminalStatus } from '../src/modules/applications/application-status';
import { passwordHasher } from '../src/modules/auth/password';
import { TokenService } from '../src/modules/auth/token';
import { AuthService } from '../src/modules/auth/auth.service';
import { EmiCalculator } from '../src/modules/lenders/emi-calculator';
import { CircuitBreaker } from '../src/modules/lenders/circuit-breaker';
import { MockLenderAdapter } from '../src/modules/lenders/adapters/mock-lender';
import { WaterfallOrchestrator } from '../src/modules/orchestration/waterfall';
import { ApplicationService } from '../src/modules/applications/application.service';
import { CheckoutService } from '../src/modules/checkout/checkout.service';
import { OfferService } from '../src/modules/offers/offer.service';
import { WebhookService } from '../src/modules/webhooks/webhook.service';
import { CommissionService } from '../src/modules/ledger/commission.service';
import { ExpirationWorker } from '../src/modules/workers/expiration.worker';
import { InMemoryStores } from '../src/modules/persistence/in-memory-store';
import { parseEnv, EnvValidationError, DEV_DEFAULT_JWT_SECRET } from '../src/config/env';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}:`, err);
    failed++;
  }
}

async function main() {
  process.env.DEV_DEFAULT_WEBHOOK_SECRET = 'lender-default-dev-secret';
  console.log('--- UDYAM PAY BACKEND LOGIC VERIFICATION ---');

  // 1. State Machine
  console.log('\n[1/10] State Machine Invariants:');
  await test('Terminal states have zero outgoing transitions', () => {
    for (const s of TERMINAL_STATUSES) {
      assert.equal(isTerminalStatus(s), true);
      for (const to of APPLICATION_STATUSES) {
        assert.equal(evaluateTransition(s, to, { actor: 'SYSTEM', lenderConfirmed: true }).allowed, false);
      }
    }
  });

  await test('Lender authority required for approved outcomes', () => {
    assert.equal(evaluateTransition('LENDER_PROCESSING', 'OFFER_AVAILABLE', { actor: 'SYSTEM' }).allowed, false);
    assert.equal(evaluateTransition('LENDER_PROCESSING', 'OFFER_AVAILABLE', { actor: 'SYSTEM', lenderConfirmed: true }).allowed, true);
    assert.equal(evaluateTransition('LENDER_PROCESSING', 'OFFER_AVAILABLE', { actor: 'MERCHANT_USER', lenderConfirmed: true }).allowed, false);
  });

  // 2. Password & Token Auth
  console.log('\n[2/10] Cryptographic Auth & Token Rotation:');
  await test('Password hashing and verification', async () => {
    const hash = await passwordHasher.hash('SuperSecret2026!');
    assert.ok(hash.startsWith('$scrypt$') || hash.startsWith('$argon2'));
    const valid = await passwordHasher.verify('SuperSecret2026!', hash);
    assert.equal(valid, true);
    const invalid = await passwordHasher.verify('WrongPassword', hash);
    assert.equal(invalid, false);
  });

  await test('JWT signing, verification, and expiry', () => {
    const tokenService = new TokenService('this-is-a-super-secret-jwt-key-min-32-chars!', 900);
    const token = tokenService.signAccessToken({
      userId: 'u-1',
      role: 'MERCHANT_OWNER',
      merchantId: 'm-1',
      tokenVersion: 1,
    });
    const payload = tokenService.verifyAccessToken(token);
    assert.equal(payload.sub, 'u-1');
    assert.equal(payload.role, 'MERCHANT_OWNER');
  });

  await test('Refresh token rotation and theft reuse detection', async () => {
    const stores = new InMemoryStores();
    const auth = new AuthService(stores, 'this-is-a-super-secret-jwt-key-min-32-chars!');
    await auth.registerMerchantOwner({
      email: 'test@shop.example',
      password: 'Password123!',
      legalName: 'Test Shop',
    });
    const login = await auth.login({ email: 'test@shop.example', password: 'Password123!' });
    const rot1 = await auth.refreshTokens(login.tokens.refreshToken);
    assert.ok(rot1.accessToken);
    assert.notEqual(rot1.refreshToken, login.tokens.refreshToken);

    // Reuse detection: re-using the old refresh token must throw and revoke family!
    await assert.rejects(
      async () => auth.refreshTokens(login.tokens.refreshToken),
      /reuse detected/
    );
  });

  await test('Production JWT security: enforces explicit valid secret, rejects missing or dev defaults', () => {
    const validUrl = 'postgresql://user:pass@localhost:5432/db';

    // Missing JWT_SECRET in production must throw EnvValidationError
    assert.throws(
      () => parseEnv({ DATABASE_URL: validUrl, NODE_ENV: 'production' }),
      (err: unknown) => err instanceof EnvValidationError && err.message.includes('JWT_SECRET'),
    );

    // Default development secret in production must throw EnvValidationError
    assert.throws(
      () => parseEnv({ DATABASE_URL: validUrl, NODE_ENV: 'production', JWT_SECRET: DEV_DEFAULT_JWT_SECRET }),
      (err: unknown) => err instanceof EnvValidationError && err.message.includes('default development secret'),
    );

    // Short secret (< 32 chars) must throw EnvValidationError
    assert.throws(
      () => parseEnv({ DATABASE_URL: validUrl, NODE_ENV: 'production', JWT_SECRET: 'short-secret' }),
      (err: unknown) => err instanceof EnvValidationError && err.message.includes('at least 32 characters'),
    );

    // Valid explicit production secret succeeds
    const prodConfig = parseEnv({
      DATABASE_URL: validUrl,
      NODE_ENV: 'production',
      JWT_SECRET: 'a-secure-production-jwt-signing-key-32-chars!',
    });
    assert.equal(prodConfig.NODE_ENV, 'production');
    assert.equal(prodConfig.JWT_SECRET, 'a-secure-production-jwt-signing-key-32-chars!');

    // Development environment uses development default when omitted
    const devConfig = parseEnv({ DATABASE_URL: validUrl, NODE_ENV: 'development' });
    assert.equal(devConfig.JWT_SECRET, DEV_DEFAULT_JWT_SECRET);

    // DEV_DEFAULT_WEBHOOK_SECRET forbidden in production
    assert.throws(
      () => parseEnv({
        DATABASE_URL: validUrl,
        NODE_ENV: 'production',
        JWT_SECRET: 'a-secure-production-jwt-signing-key-32-chars!',
        DEV_DEFAULT_WEBHOOK_SECRET: 'dev-webhook-secret',
      }),
      (err: unknown) => err instanceof EnvValidationError && err.message.includes('DEV_DEFAULT_WEBHOOK_SECRET'),
    );
  });

  // 3. EMI Calculator
  console.log('\n[3/10] Integer Paise EMI Calculations:');
  await test('Reducing balance amortization with zero lost paise', () => {
    const principalPaise = 10000000n; // Rs 1,00,000
    const result = EmiCalculator.calculate({
      principalPaise,
      tenureMonths: 12,
      annualInterestRatePercent: 12,
      rateType: 'REDUCING_BALANCE',
      processingFeePercent: 1.5,
    });
    assert.equal(result.principalPaise, principalPaise);
    assert.equal(result.processingFeePaise, 150000n);
    const sumPrincipal = result.schedule.reduce((s, i) => s + i.principalPaise, 0n);
    assert.equal(sumPrincipal, principalPaise);
    assert.equal(result.schedule[11]!.remainingPrincipalPaise, 0n);
  });

  // 4. Circuit Breaker
  console.log('\n[4/10] Circuit Breaker:');
  await test('Trips to OPEN on 3 failures and recovers to CLOSED after probe', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 20, halfOpenSuccessThreshold: 2 });
    assert.equal(cb.getState(), 'CLOSED');
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    assert.equal(cb.getState(), 'OPEN');
    assert.equal(cb.canExecute(), false);

    await new Promise((r) => setTimeout(r, 30));
    assert.equal(cb.getState(), 'HALF_OPEN');
    cb.recordSuccess();
    assert.equal(cb.getState(), 'HALF_OPEN');
    cb.recordSuccess();
    assert.equal(cb.getState(), 'CLOSED');
  });

  // 5. Mock Lender Scenarios
  console.log('\n[5/10] Deterministic Mock Lenders:');
  await test('Deterministically declines, approves, and simulates 503', async () => {
    const adapter = new MockLenderAdapter({ code: 'ALPHA', displayName: 'Alpha' });
    const approve = await adapter.submitApplication({
      applicationId: 'app-1',
      requestKey: 'req-1',
      merchantId: 'm-1',
      customer: { id: 'c-1', fullName: 'Raj', phone: '+919999999999' },
      purchase: { id: 'p-1', amountPaise: 5000000n, productCategory: 'SMARTPHONE' },
      requestedAmountPaise: 5000000n,
    });
    assert.equal(approve.outcome, 'OFFERED');
    assert.ok(approve.offers!.length > 0);

    const decline = await adapter.submitApplication({
      applicationId: 'app-2',
      requestKey: 'req-2',
      merchantId: 'm-1',
      customer: { id: 'c-2', fullName: 'Decline Case', phone: '+919999990001' },
      purchase: { id: 'p-1', amountPaise: 5000000n, productCategory: 'SMARTPHONE' },
      requestedAmountPaise: 5000000n,
    });
    assert.equal(decline.outcome, 'DECLINED');

    const unavail = await adapter.submitApplication({
      applicationId: 'app-3',
      requestKey: 'req-3',
      merchantId: 'm-1',
      customer: { id: 'c-3', fullName: 'Down Case', phone: '+919999990004' },
      purchase: { id: 'p-1', amountPaise: 5000000n, productCategory: 'SMARTPHONE' },
      requestedAmountPaise: 5000000n,
    });
    assert.equal(unavail.outcome, 'UNAVAILABLE');
  });

  // 6. Waterfall Orchestrator & Fallback
  console.log('\n[6/10] Waterfall Orchestrator & Result Applier:');
  await test('Sequential waterfall falls back when primary lender declines', async () => {
    const stores = new InMemoryStores();
    const m = await stores.merchants.create({ legalName: 'Apex', tradeName: 'Apex', status: 'VERIFIED', verifiedAt: new Date(), suspendedAt: null, suspensionReason: null });
    const s = await stores.shops.create({ merchantId: m.id, name: 'Shop 1', city: 'BLR', state: 'KA', status: 'ACTIVE' });
    const c = await stores.customers.create({ merchantId: m.id, fullName: 'Vikram', phone: '+919999990001', retentionExpiresAt: null, anonymizedAt: null });
    const p = await stores.purchases.createIdempotent({ merchantId: m.id, shopId: s.id, customerId: c.id, productCategory: 'SMARTPHONE', productDescription: 'Phone', amountPaise: 5000000n, currency: 'INR', idempotencyKey: 'pk-1' });

    const l1 = await stores.lenders.create({ code: 'ALPHA', displayName: 'Alpha', type: 'BANK', isSimulated: true, status: 'ACTIVE' });
    await stores.lenders.saveConfig({ lenderId: l1.id, enabled: true, priority: 10, minAmountPaise: null, maxAmountPaise: null, supportedCategories: [], supportsDiscovery: false, fallbackOnDecline: true, requestTimeoutMs: 1000, maxSafeRetries: 1, routingRules: null, secretRef: null, updatedByUserId: null });

    const l2 = await stores.lenders.create({ code: 'BETA', displayName: 'Beta', type: 'NBFC', isSimulated: true, status: 'ACTIVE' });
    await stores.lenders.saveConfig({ lenderId: l2.id, enabled: true, priority: 20, minAmountPaise: null, maxAmountPaise: null, supportedCategories: [], supportsDiscovery: false, fallbackOnDecline: true, requestTimeoutMs: 1000, maxSafeRetries: 1, routingRules: null, secretRef: null, updatedByUserId: null });

    const adapters = new Map();
    adapters.set('ALPHA', new MockLenderAdapter({ code: 'ALPHA', displayName: 'Alpha' })); // will decline on 0001
    adapters.set('BETA', new MockLenderAdapter({ code: 'BETA', displayName: 'Beta', fixedScenario: 'APPROVE' })); // will approve

    const app = await stores.applications.create({
      merchantId: m.id,
      shopId: s.id,
      purchaseId: p.id,
      customerId: c.id,
      createdByUserId: null,
      status: 'SUBMITTED',
      routingMode: 'SEQUENTIAL',
      requestedAmountPaise: 5000000n,
      downPaymentPaise: 0n,
      requestedTenureMonths: 6,
      idempotencyKey: 'app-fall-1',
      submittedAt: new Date(),
      expiresAt: null,
      terminalAt: null,
    });

    const orchestrator = new WaterfallOrchestrator(stores, adapters);
    const finalApp = await orchestrator.execute(app.id);
    assert.equal(finalApp.status, 'OFFER_AVAILABLE');

    const attempts = await stores.lenderApplications.listByApplication(app.id);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0]!.outcome, 'DECLINED');
    assert.equal(attempts[1]!.outcome, 'OFFERED');
  });

  // 7. Applications & One-Active-Per-Purchase Invariant
  console.log('\n[7/10] Applications Service & Concurrency Invariant:');
  await test('Enforces at most one active application per purchase', async () => {
    const stores = new InMemoryStores();
    const appService = new ApplicationService(stores);
    const m = await stores.merchants.create({ legalName: 'Apex', tradeName: 'Apex', status: 'VERIFIED', verifiedAt: new Date(), suspendedAt: null, suspensionReason: null });
    const s = await stores.shops.create({ merchantId: m.id, name: 'S1', city: 'B', state: 'K', status: 'ACTIVE' });
    const c = await stores.customers.create({ merchantId: m.id, fullName: 'Kavita', phone: '+919876543210', retentionExpiresAt: null, anonymizedAt: null });
    const p = await stores.purchases.createIdempotent({ merchantId: m.id, shopId: s.id, customerId: c.id, productCategory: 'TELEVISION', productDescription: 'TV', amountPaise: 6000000n, currency: 'INR', idempotencyKey: 'p-active-1' });

    // 1st app
    const app1 = await appService.createApplication({
      merchantId: m.id,
      shopId: s.id,
      purchaseId: p.id,
      customerId: c.id,
      requestedAmountPaise: 6000000n,
      idempotencyKey: 'app-first',
    });
    assert.ok(app1.id);

    // 2nd app for same purchase while app1 is active must throw ConflictError!
    await assert.rejects(
      async () => appService.createApplication({
        merchantId: m.id,
        shopId: s.id,
        purchaseId: p.id,
        customerId: c.id,
        requestedAmountPaise: 6000000n,
        idempotencyKey: 'app-second',
      }),
      /already has an active financing application/
    );
  });

  // 8. Checkout Sessions & QR
  console.log('\n[8/10] Checkout Sessions & QR:');
  await test('Generates unguessable token and consumes atomically', async () => {
    const stores = new InMemoryStores();
    const checkout = new CheckoutService(stores);
    const m = await stores.merchants.create({ legalName: 'Apex', tradeName: 'Apex', status: 'VERIFIED', verifiedAt: new Date(), suspendedAt: null, suspensionReason: null });
    const s = await stores.shops.create({ merchantId: m.id, name: 'S1', city: 'B', state: 'K', status: 'ACTIVE' });
    const p = await stores.purchases.createIdempotent({ merchantId: m.id, shopId: s.id, customerId: null, productCategory: 'LAPTOP', productDescription: 'MacBook', amountPaise: 12000000n, currency: 'INR', idempotencyKey: 'p-cs-1' });

    const session = await checkout.createSession({ merchantId: m.id, shopId: s.id, purchaseId: p.id });
    assert.ok(session.rawToken!.startsWith('cs_'));
    assert.ok(session.qrPayload.includes(session.rawToken!));

    const scanned = await checkout.getSessionByToken(session.rawToken!);
    assert.equal(scanned.session.id, session.session.id);

    await checkout.consumeSession(session.rawToken!);
    await assert.rejects(
      async () => checkout.getSessionByToken(session.rawToken!),
      /already been used/
    );
  });

  // 9. Webhooks & Cryptographic Signature
  console.log('\n[9/10] Webhook Verification & Disbursement:');
  await test('Verifies HMAC SHA-256 signature, rejects stale replay, and processes disbursement', async () => {
    const stores = new InMemoryStores();
    const webhooks = new WebhookService(stores, 300);
    await stores.lenders.create({ code: 'LENDER_ALPHA', displayName: 'Alpha', type: 'BANK', isSimulated: true, status: 'ACTIVE' });
    const m = await stores.merchants.create({ legalName: 'Apex', tradeName: 'Apex', status: 'VERIFIED', verifiedAt: new Date(), suspendedAt: null, suspensionReason: null });
    const s = await stores.shops.create({ merchantId: m.id, name: 'S1', city: 'B', state: 'K', status: 'ACTIVE' });
    const c = await stores.customers.create({ merchantId: m.id, fullName: 'Kavita', phone: '+919876543210', retentionExpiresAt: null, anonymizedAt: null });
    const p = await stores.purchases.createIdempotent({ merchantId: m.id, shopId: s.id, customerId: c.id, productCategory: 'TELEVISION', productDescription: 'TV', amountPaise: 6000000n, currency: 'INR', idempotencyKey: 'p-wh-1' });
    const app = await stores.applications.create({
      merchantId: m.id,
      shopId: s.id,
      purchaseId: p.id,
      customerId: c.id,
      createdByUserId: null,
      status: 'DISBURSEMENT_PENDING',
      routingMode: 'SEQUENTIAL',
      requestedAmountPaise: 6000000n,
      downPaymentPaise: 0n,
      requestedTenureMonths: 6,
      idempotencyKey: 'app-wh-1',
      submittedAt: new Date(),
      expiresAt: null,
      terminalAt: null,
    });

    const payload = JSON.stringify({
      eventId: 'evt_test_100',
      eventType: 'LOAN_DISBURSED',
      applicationId: app.id,
      externalReference: 'EXT-100',
      amountPaise: 6000000,
    });
    const now = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac('sha256', 'lender-default-dev-secret').update(`${now}.${payload}`).digest('hex');

    const result = await webhooks.processWebhook({
      lenderCode: 'LENDER_ALPHA',
      rawPayload: payload,
      signatureHeader: signature,
      timestampHeader: now,
    });
    assert.equal(result.processed, true);
    assert.equal(result.duplicate, false);

    const updatedApp = await stores.applications.findById(app.id);
    assert.equal(updatedApp!.status, 'DISBURSED');

    // De-duplication check: re-sending the same webhook returns duplicate = true
    const dupeResult = await webhooks.processWebhook({
      lenderCode: 'LENDER_ALPHA',
      rawPayload: payload,
      signatureHeader: signature,
      timestampHeader: now,
    });
    assert.equal(dupeResult.duplicate, true);
  });

  await test('Fails closed if lender webhook secret is not configured', async () => {
    const stores = new InMemoryStores();
    const webhooks = new WebhookService(stores, 300);
    await stores.lenders.create({ code: 'UNCONFIGURED_LENDER', displayName: 'Unconfigured', type: 'BANK', isSimulated: true, status: 'ACTIVE' });
    const prevEnv = process.env.DEV_DEFAULT_WEBHOOK_SECRET;
    delete process.env.DEV_DEFAULT_WEBHOOK_SECRET;
    try {
      await assert.rejects(
        async () => webhooks.processWebhook({
          lenderCode: 'UNCONFIGURED_LENDER',
          rawPayload: '{}',
        }),
        /Webhook secret is not configured/
      );
    } finally {
      process.env.DEV_DEFAULT_WEBHOOK_SECRET = prevEnv;
    }
  });

  await test('Rejects webhook with invalid HMAC signature', async () => {
    const stores = new InMemoryStores();
    const webhooks = new WebhookService(stores, 300);
    await stores.lenders.create({ code: 'LENDER_ALPHA', displayName: 'Alpha', type: 'BANK', isSimulated: true, status: 'ACTIVE' });
    await assert.rejects(
      async () => webhooks.processWebhook({
        lenderCode: 'LENDER_ALPHA',
        rawPayload: '{"eventId":"test_inv"}',
        signatureHeader: 'bad-signature-hex',
        timestampHeader: Math.floor(Date.now() / 1000).toString(),
      }),
      /Invalid webhook signature/
    );
  });

  // 10. Financial Commission Accounting
  console.log('\n[10/10] Commission Ledger & Immutability:');
  await test('Enforces positive amounts, single accrual per transaction, and unique reversal', async () => {
    const stores = new InMemoryStores();
    const commission = new CommissionService(stores);
    const m = await stores.merchants.create({ legalName: 'Apex', tradeName: 'Apex', status: 'VERIFIED', verifiedAt: new Date(), suspendedAt: null, suspensionReason: null });
    const s = await stores.shops.create({ merchantId: m.id, name: 'S1', city: 'B', state: 'K', status: 'ACTIVE' });
    const c = await stores.customers.create({ merchantId: m.id, fullName: 'Kavita', phone: '+919876543210', retentionExpiresAt: null, anonymizedAt: null });
    const p = await stores.purchases.createIdempotent({ merchantId: m.id, shopId: s.id, customerId: c.id, productCategory: 'TELEVISION', productDescription: 'TV', amountPaise: 6000000n, currency: 'INR', idempotencyKey: 'p-comm-1' });
    const app = await stores.applications.create({
      merchantId: m.id,
      shopId: s.id,
      purchaseId: p.id,
      customerId: c.id,
      createdByUserId: null,
      status: 'DISBURSED',
      routingMode: 'SEQUENTIAL',
      requestedAmountPaise: 6000000n,
      downPaymentPaise: 0n,
      requestedTenureMonths: 6,
      idempotencyKey: 'app-comm-1',
      submittedAt: new Date(),
      expiresAt: null,
      terminalAt: null,
    });

    const tx = await stores.transactions.create({
      merchantId: m.id,
      applicationId: app.id,
      lenderApplicationId: null,
      lenderId: null,
      type: 'LOAN_DISBURSEMENT',
      status: 'CONFIRMED',
      amountPaise: 6000000n,
      lenderTransactionRef: 'TX-1',
      lenderConfirmedAt: new Date(),
      reconciliationStatus: 'MATCHED',
      reconciledAt: new Date(),
    });

    const accrual = await commission.accrue({
      merchantId: m.id,
      applicationId: app.id,
      transactionId: tx.id,
      amountPaise: 90000n, // Rs 900
      ruleCode: '1.5_PERCENT',
      ruleSnapshot: { rate: 1.5 },
    });
    assert.equal(accrual.amountPaise, 90000n);

    // Attempting second accrual for the same transaction must throw ConflictError!
    await assert.rejects(
      async () => commission.accrue({
        merchantId: m.id,
        applicationId: app.id,
        transactionId: tx.id,
        amountPaise: 90000n,
        ruleCode: '1.5_PERCENT',
        ruleSnapshot: { rate: 1.5 },
      }),
      /Multiple accruals forbidden/
    );

    // Reversal
    const reversal = await commission.reverse({
      commissionEntryId: accrual.id,
      reason: 'Loan cancelled and returned',
    });
    assert.equal(reversal.entryType, 'REVERSAL');
    assert.equal(reversal.amountPaise, 90000n);

    // Second reversal on same accrual must throw!
    await assert.rejects(
      async () => commission.reverse({
        commissionEntryId: accrual.id,
        reason: 'Second reversal attempt',
      }),
      /already been reversed/
    );

    // Attempting to reverse a non-existent entry must throw NotFoundError!
    await assert.rejects(
      async () => commission.reverse({
        commissionEntryId: 'non-existent-entry-id',
        reason: 'Missing entry',
      }),
      /not found/
    );

    // Attempting to reverse a reversal entry must throw ConflictError!
    await assert.rejects(
      async () => commission.reverse({
        commissionEntryId: reversal.id,
        reason: 'Cannot reverse reversal',
      }),
      /Only ACCRUAL entries can be reversed/
    );

    const summary = await commission.getMerchantSummary(m.id);
    assert.equal(summary.totalAccruedPaise, 90000n);
    assert.equal(summary.totalReversedPaise, 90000n);
    assert.equal(summary.netCommissionPaise, 0n); // 90000 - 90000 = 0
  });

  // 11. Expiration Worker & State Lifecycle
  console.log('\n[11/12] Expiration Worker & State Transitions:');
  await test('Sweeps expired checkout sessions and applications using state machine assertions', async () => {
    const stores = new InMemoryStores();
    const worker = new ExpirationWorker(stores, { batchSize: 50 });
    const m = await stores.merchants.create({ legalName: 'Apex', tradeName: 'Apex', status: 'VERIFIED', verifiedAt: new Date(), suspendedAt: null, suspensionReason: null });
    const s = await stores.shops.create({ merchantId: m.id, name: 'S1', city: 'B', state: 'K', status: 'ACTIVE' });
    const c = await stores.customers.create({ merchantId: m.id, fullName: 'Deepak', phone: '+919876543299', retentionExpiresAt: null, anonymizedAt: null });
    const p1 = await stores.purchases.createIdempotent({ merchantId: m.id, shopId: s.id, customerId: c.id, productCategory: 'TELEVISION', productDescription: 'TV', amountPaise: 4000000n, currency: 'INR', idempotencyKey: 'p-exp-1' });
    const p2 = await stores.purchases.createIdempotent({ merchantId: m.id, shopId: s.id, customerId: c.id, productCategory: 'LAPTOP', productDescription: 'Laptop', amountPaise: 6000000n, currency: 'INR', idempotencyKey: 'p-exp-2' });

    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const tenMinFuture = new Date(Date.now() + 10 * 60 * 1000);

    const expiredSession = await stores.checkoutSessions.create({
      merchantId: m.id,
      shopId: s.id,
      purchaseId: p1.id,
      status: 'ACTIVE',
      tokenHash: 'hash-exp-1',
      createdByUserId: null,
      expiresAt: tenMinAgo,
      consumedAt: null,
      revokedAt: null,
    });

    const activeSession = await stores.checkoutSessions.create({
      merchantId: m.id,
      shopId: s.id,
      purchaseId: p1.id,
      status: 'ACTIVE',
      tokenHash: 'hash-act-1',
      createdByUserId: null,
      expiresAt: tenMinFuture,
      consumedAt: null,
      revokedAt: null,
    });

    const expiredApp = await stores.applications.create({
      merchantId: m.id,
      shopId: s.id,
      purchaseId: p1.id,
      customerId: c.id,
      createdByUserId: null,
      status: 'DRAFT',
      routingMode: 'SEQUENTIAL',
      requestedAmountPaise: 4000000n,
      downPaymentPaise: 0n,
      requestedTenureMonths: 6,
      idempotencyKey: 'app-exp-1',
      submittedAt: null,
      expiresAt: tenMinAgo,
      terminalAt: null,
    });

    const activeApp = await stores.applications.create({
      merchantId: m.id,
      shopId: s.id,
      purchaseId: p2.id,
      customerId: c.id,
      createdByUserId: null,
      status: 'OFFER_AVAILABLE',
      routingMode: 'SEQUENTIAL',
      requestedAmountPaise: 4000000n,
      downPaymentPaise: 0n,
      requestedTenureMonths: 6,
      idempotencyKey: 'app-active-1',
      submittedAt: new Date(),
      expiresAt: tenMinFuture,
      terminalAt: null,
    });

    const sweepResult = await worker.runSweep(new Date());
    assert.equal(sweepResult.expiredSessions, 1);
    assert.equal(sweepResult.expiredApplications, 1);

    const s1 = await stores.checkoutSessions.findById(expiredSession.id);
    assert.equal(s1!.status, 'EXPIRED');

    const s2 = await stores.checkoutSessions.findById(activeSession.id);
    assert.equal(s2!.status, 'ACTIVE');

    const a1 = await stores.applications.findById(expiredApp.id);
    assert.equal(a1!.status, 'EXPIRED');
    assert.ok(a1!.terminalAt instanceof Date);

    const a2 = await stores.applications.findById(activeApp.id);
    assert.equal(a2!.status, 'OFFER_AVAILABLE');

    // Safe repeated execution: next sweep produces 0 expired
    const repeatedResult = await worker.runSweep(new Date());
    assert.equal(repeatedResult.expiredSessions, 0);
    assert.equal(repeatedResult.expiredApplications, 0);
  });

  // 12. Complete End-to-End Main Business Flow (Lifecycle & Failure Paths)
  console.log('\n[12/12] Complete Main Business Flow End-to-End:');
  await test('Full lifecycle from merchant registration to disbursement, commission ledger, and DPDP erasure', async () => {
    const stores = new InMemoryStores();
    const authService = new AuthService(stores, 'super-secret-jwt-key-min-32-chars-for-test!');
    const checkoutService = new CheckoutService(stores);
    const offerService = new OfferService(stores);
    const webhookService = new WebhookService(stores, 300);
    const commissionService = new CommissionService(stores);

    // Setup Mock Lenders
    const lenderAlpha = await stores.lenders.create({
      code: 'LENDER_ALPHA',
      displayName: 'Alpha Digital Bank',
      type: 'BANK',
      isSimulated: true,
      status: 'ACTIVE',
    });
    await stores.lenders.saveConfig({
      lenderId: lenderAlpha.id,
      enabled: true,
      priority: 10,
      minAmountPaise: 100000n,
      maxAmountPaise: 50000000n,
      supportedCategories: ['SMARTPHONE', 'TELEVISION', 'LAPTOP'],
      supportsDiscovery: true,
      fallbackOnDecline: true,
      requestTimeoutMs: 2000,
      maxSafeRetries: 1,
      routingRules: null,
      secretRef: null,
      updatedByUserId: null,
    });

    const adapters = new Map();
    adapters.set('LENDER_ALPHA', new MockLenderAdapter({ code: 'LENDER_ALPHA', displayName: 'Alpha Digital Bank', fixedScenario: 'APPROVE' }));
    const orchestrator = new WaterfallOrchestrator(stores, adapters);
    const applicationService = new ApplicationService(stores, orchestrator);

    // Step 1: Merchant Owner Registration
    const ownerReg = await authService.registerMerchantOwner({
      email: 'sharma@retail.example',
      password: 'SecurePassword2026!',
      legalName: 'Sharma Electronics Pvt Ltd',
      tradeName: 'Sharma Electronics',
    });
    assert.ok(ownerReg.merchantId);
    const login = await authService.login({
      email: 'sharma@retail.example',
      password: 'SecurePassword2026!',
    });
    assert.ok(login.tokens.accessToken);

    // Verify Merchant
    await stores.merchants.updateStatus(ownerReg.merchantId, 'VERIFIED');

    // Step 2: Create Shop
    const shop = await stores.shops.create({
      merchantId: ownerReg.merchantId,
      name: 'Sharma Electronics Indiranagar',
      city: 'Bengaluru',
      state: 'Karnataka',
      status: 'ACTIVE',
    });
    assert.ok(shop.id);

    // Step 3: Register Customer & Purpose Consent
    const customer = await stores.customers.create({
      merchantId: ownerReg.merchantId,
      fullName: 'Vikram Mehta',
      phone: '+919876543210',
      retentionExpiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      anonymizedAt: null,
    });
    const consent = await stores.consents.create({
      merchantId: ownerReg.merchantId,
      customerId: customer.id,
      purpose: 'FINANCING_APPLICATION_PROCESSING',
      noticeVersion: 'v1.0-2026',
      captureMethod: 'MERCHANT_ASSISTED',
      grantedAt: new Date(),
      revokedAt: null,
    });
    assert.equal(consent.revokedAt, null);

    // Step 4: Create Purchase Idempotently
    const purchase = await stores.purchases.createIdempotent({
      merchantId: ownerReg.merchantId,
      shopId: shop.id,
      customerId: customer.id,
      productCategory: 'TELEVISION',
      productDescription: 'Sony Bravia 55 inch 4K HDR',
      amountPaise: 6500000n, // Rs 65,000
      currency: 'INR',
      idempotencyKey: 'idemp-sony-tv-100',
    });
    assert.equal(purchase.amountPaise, 6500000n);

    // Step 5: Checkout Session & QR Generation
    const checkoutSession = await checkoutService.createSession({
      merchantId: ownerReg.merchantId,
      shopId: shop.id,
      purchaseId: purchase.id,
      validityMinutes: 30,
    });
    assert.ok(checkoutSession.rawToken!.startsWith('cs_'));
    assert.ok(checkoutSession.qrPayload.includes(checkoutSession.rawToken!));

    // Step 6: Public Scan of QR Token
    const scanned = await checkoutService.getSessionByToken(checkoutSession.rawToken!);
    assert.equal(scanned.session.id, checkoutSession.session.id);
    assert.equal(scanned.purchase.amountPaise, 6500000n);

    // Step 7: Create Financing Application & Enforce One-Active Invariant
    const application = await applicationService.createApplication({
      merchantId: ownerReg.merchantId,
      shopId: shop.id,
      purchaseId: purchase.id,
      customerId: customer.id,
      requestedAmountPaise: 6500000n,
      downPaymentPaise: 0n,
      requestedTenureMonths: 6,
      idempotencyKey: 'app-sony-tv-100',
    });
    assert.ok(application.id);

    // Second application on same purchase must be rejected
    await assert.rejects(
      async () => applicationService.createApplication({
        merchantId: ownerReg.merchantId,
        shopId: shop.id,
        purchaseId: purchase.id,
        customerId: customer.id,
        requestedAmountPaise: 6500000n,
        idempotencyKey: 'app-sony-tv-second',
      }),
      /already has an active financing application/
    );

    // Step 8: Submit Application -> Waterfall Evaluation
    const submittedApp = await applicationService.submitApplication({
      applicationId: application.id,
      merchantId: ownerReg.merchantId,
      actor: 'MERCHANT_USER',
    });
    assert.equal(submittedApp.status, 'OFFER_AVAILABLE');

    // Step 9: Offers Retrieval & Acceptance
    const offers = await offerService.listOffers(application.id);
    assert.ok(offers.length > 0);
    const selectedOffer = offers[0]!;

    const acceptedResult = await offerService.acceptOffer({
      applicationId: application.id,
      offerId: selectedOffer.id,
      actorType: 'MERCHANT_USER',
    });
    assert.equal(acceptedResult.applicationStatus, 'CUSTOMER_ACCEPTED_OFFER');

    // Step 10: Asynchronous Lender Webhook: Loan Disbursed
    const webhookPayload = JSON.stringify({
      eventId: 'evt_lender_alpha_disburse_1',
      eventType: 'LOAN_DISBURSED',
      applicationId: application.id,
      externalReference: `ALPHA-REF-${application.id}`,
      amountPaise: 6500000,
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac('sha256', 'lender-default-dev-secret')
      .update(`${timestamp}.${webhookPayload}`)
      .digest('hex');

    const webhookRes = await webhookService.processWebhook({
      lenderCode: 'LENDER_ALPHA',
      rawPayload: webhookPayload,
      signatureHeader: signature,
      timestampHeader: timestamp,
    });
    assert.equal(webhookRes.processed, true);
    assert.equal(webhookRes.duplicate, false);

    // Step 11: Disbursement Status & Application Transition
    const finalApp = await stores.applications.findById(application.id);
    assert.equal(finalApp!.status, 'DISBURSED');

    // Step 12: Commission Ledger Posting (automatically posted upon loan disbursement)
    const commissionSummary = await commissionService.getMerchantSummary(ownerReg.merchantId);
    assert.equal(commissionSummary.netCommissionPaise, 97500n);
    assert.equal(commissionSummary.entries.length, 1);
    assert.equal(commissionSummary.entries[0]!.entryType, 'ACCRUAL');
    assert.equal(commissionSummary.entries[0]!.amountPaise, 97500n);

    // Verify duplicate accrual on same transaction is rejected
    const txList = await stores.transactions.findByApplication(application.id);
    assert.equal(txList.length, 1);
    await assert.rejects(
      async () => commissionService.accrue({
        merchantId: ownerReg.merchantId,
        applicationId: application.id,
        transactionId: txList[0]!.id,
        amountPaise: 97500n,
        ruleCode: '1.5_PERCENT_RETAIL',
        ruleSnapshot: { rate: 1.5, basePaise: 6500000 },
      }),
      /Multiple accruals forbidden/
    );

    // Step 13: Audit Trail Verification
    const history = await stores.applications.getStatusHistory(application.id);
    const statuses = history.map(h => h.toStatus);
    assert.ok(statuses.includes('CUSTOMER_CONSENT_PENDING'));
    assert.ok(statuses.includes('SUBMITTED'));
    assert.ok(statuses.includes('LENDER_PROCESSING'));
    assert.ok(statuses.includes('OFFER_AVAILABLE'));
    assert.ok(statuses.includes('CUSTOMER_ACCEPTED_OFFER'));
    assert.ok(statuses.includes('DISBURSED'));

    // Step 14: DPDP Consent Revocation & Right-to-Erasure (Anonymization)
    await stores.consents.revoke(consent.id);
    const activeConsent = await stores.consents.findActive(customer.id, 'FINANCING_APPLICATION_PROCESSING');
    assert.equal(activeConsent, null);

    await stores.customers.anonymizeCustomer(customer.id);
    const anonymized = await stores.customers.findById(customer.id);
    assert.equal(anonymized!.fullName, '[ANONYMIZED]');
    assert.ok(anonymized!.phone.startsWith('+9100000'));
    assert.notEqual(anonymized!.phone, '+919876543210');
    assert.ok(anonymized!.anonymizedAt instanceof Date);
  });

  await test('Failure scenario: Waterfall falls back to secondary lender when primary declines', async () => {
    const stores = new InMemoryStores();
    const l1 = await stores.lenders.create({ code: 'ALPHA', displayName: 'Alpha Bank', type: 'BANK', isSimulated: true, status: 'ACTIVE' });
    await stores.lenders.saveConfig({ lenderId: l1.id, enabled: true, priority: 1, minAmountPaise: null, maxAmountPaise: null, supportedCategories: [], supportsDiscovery: false, fallbackOnDecline: true, requestTimeoutMs: 1000, maxSafeRetries: 1, routingRules: null, secretRef: null, updatedByUserId: null });

    const l2 = await stores.lenders.create({ code: 'BETA', displayName: 'Beta NBFC', type: 'NBFC', isSimulated: true, status: 'ACTIVE' });
    await stores.lenders.saveConfig({ lenderId: l2.id, enabled: true, priority: 2, minAmountPaise: null, maxAmountPaise: null, supportedCategories: [], supportsDiscovery: false, fallbackOnDecline: true, requestTimeoutMs: 1000, maxSafeRetries: 1, routingRules: null, secretRef: null, updatedByUserId: null });

    const adapters = new Map();
    // Primary lender will decline; secondary lender will approve
    adapters.set('ALPHA', new MockLenderAdapter({ code: 'ALPHA', displayName: 'Alpha', fixedScenario: 'DECLINE' }));
    adapters.set('BETA', new MockLenderAdapter({ code: 'BETA', displayName: 'Beta', fixedScenario: 'APPROVE' }));

    const m = await stores.merchants.create({ legalName: 'Apex', tradeName: 'Apex', status: 'VERIFIED', verifiedAt: new Date(), suspendedAt: null, suspensionReason: null });
    const s = await stores.shops.create({ merchantId: m.id, name: 'S1', city: 'B', state: 'K', status: 'ACTIVE' });
    const c = await stores.customers.create({ merchantId: m.id, fullName: 'Rohit', phone: '+919999990000', retentionExpiresAt: null, anonymizedAt: null });
    const p = await stores.purchases.createIdempotent({ merchantId: m.id, shopId: s.id, customerId: c.id, productCategory: 'SMARTPHONE', productDescription: 'Phone', amountPaise: 3000000n, currency: 'INR', idempotencyKey: 'pk-failover-1' });

    const app = await stores.applications.create({
      merchantId: m.id,
      shopId: s.id,
      purchaseId: p.id,
      customerId: c.id,
      createdByUserId: null,
      status: 'SUBMITTED',
      routingMode: 'SEQUENTIAL',
      requestedAmountPaise: 3000000n,
      downPaymentPaise: 0n,
      requestedTenureMonths: 6,
      idempotencyKey: 'app-failover-1',
      submittedAt: new Date(),
      expiresAt: null,
      terminalAt: null,
    });

    const orchestrator = new WaterfallOrchestrator(stores, adapters);
    const finalApp = await orchestrator.execute(app.id);
    assert.equal(finalApp.status, 'OFFER_AVAILABLE');

    const attempts = await stores.lenderApplications.listByApplication(app.id);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0]!.outcome, 'DECLINED');
    assert.equal(attempts[1]!.outcome, 'OFFERED');
  });

  console.log(`\n========================================`);
  console.log(`TOTAL TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
