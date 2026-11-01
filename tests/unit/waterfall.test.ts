import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../../src/modules/lenders/circuit-breaker';
import { MockLenderAdapter } from '../../src/modules/lenders/adapters/mock-lender';
import { WaterfallOrchestrator } from '../../src/modules/orchestration/waterfall';
import { InMemoryStores } from '../../src/modules/persistence/in-memory-store';

describe('WaterfallOrchestrator', () => {
  async function setup() {
    const stores = new InMemoryStores();
    const merchant = await stores.merchants.create({
      legalName: 'Apex Electronics',
      tradeName: 'Apex',
      status: 'VERIFIED',
      verifiedAt: new Date(),
      suspendedAt: null,
      suspensionReason: null,
    });
    const shop = await stores.shops.create({
      merchantId: merchant.id,
      name: 'Downtown',
      city: 'Bengaluru',
      state: 'KA',
      status: 'ACTIVE',
    });
    const customer = await stores.customers.create({
      merchantId: merchant.id,
      fullName: 'Rahul Sharma',
      phone: '+919876543210',
      retentionExpiresAt: null,
      anonymizedAt: null,
    });
    const purchase = await stores.purchases.createIdempotent({
      merchantId: merchant.id,
      shopId: shop.id,
      customerId: customer.id,
      productCategory: 'SMARTPHONE',
      productDescription: 'Pixel 9',
      amountPaise: 7500000n, // Rs 75,000
      currency: 'INR',
      idempotencyKey: 'purch-pixel-9',
    });

    // Lender 1 (Priority 10)
    const lender1 = await stores.lenders.create({
      code: 'LENDER_ALPHA',
      displayName: 'Alpha Bank',
      type: 'BANK',
      isSimulated: true,
      status: 'ACTIVE',
    });
    await stores.lenders.saveConfig({
      lenderId: lender1.id,
      enabled: true,
      priority: 10,
      minAmountPaise: 100000n,
      maxAmountPaise: 50000000n,
      supportedCategories: ['SMARTPHONE', 'LAPTOP'],
      supportsDiscovery: true,
      fallbackOnDecline: true,
      requestTimeoutMs: 500,
      maxSafeRetries: 1,
      routingRules: null,
      secretRef: null,
      updatedByUserId: null,
    });

    // Lender 2 (Priority 20 - Fallback)
    const lender2 = await stores.lenders.create({
      code: 'LENDER_BETA',
      displayName: 'Beta NBFC',
      type: 'NBFC',
      isSimulated: true,
      status: 'ACTIVE',
    });
    await stores.lenders.saveConfig({
      lenderId: lender2.id,
      enabled: true,
      priority: 20,
      minAmountPaise: 100000n,
      maxAmountPaise: 50000000n,
      supportedCategories: ['SMARTPHONE'],
      supportsDiscovery: true,
      fallbackOnDecline: true,
      requestTimeoutMs: 500,
      maxSafeRetries: 1,
      routingRules: null,
      secretRef: null,
      updatedByUserId: null,
    });

    const adapters = new Map();
    adapters.set(
      'LENDER_ALPHA',
      new MockLenderAdapter({ code: 'LENDER_ALPHA', displayName: 'Alpha', simulatedDelayMs: 5 }),
    );
    adapters.set(
      'LENDER_BETA',
      new MockLenderAdapter({ code: 'LENDER_BETA', displayName: 'Beta', simulatedDelayMs: 5 }),
    );

    return { stores, merchant, shop, customer, purchase, lender1, lender2, adapters };
  }

  it('runs sequential waterfall and offers immediately on primary lender', async () => {
    const { stores, merchant, shop, customer, purchase, adapters } = await setup();

    const app = await stores.applications.create({
      merchantId: merchant.id,
      shopId: shop.id,
      purchaseId: purchase.id,
      customerId: customer.id,
      createdByUserId: null,
      status: 'SUBMITTED',
      routingMode: 'SEQUENTIAL',
      requestedAmountPaise: 7500000n,
      downPaymentPaise: 0n,
      requestedTenureMonths: 6,
      idempotencyKey: 'app-seq-1',
      submittedAt: new Date(),
      expiresAt: null,
      terminalAt: null,
    });

    const orchestrator = new WaterfallOrchestrator(stores, adapters);
    const finalApp = await orchestrator.execute(app.id);

    expect(finalApp.status).toBe('OFFER_AVAILABLE');

    const attempts = await stores.lenderApplications.listByApplication(app.id);
    expect(attempts.length).toBe(1);
    expect(attempts[0]?.outcome).toBe('OFFERED');

    const offers = await stores.offers.listByApplication(app.id);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers[0]?.tenureMonths).toBe(6);
  });

  it('falls back to secondary lender when primary lender declines', async () => {
    const { stores, merchant, shop, purchase, adapters } = await setup();

    // Specific customer with phone ending in 0001 (triggers Alpha decline)
    const customer = await stores.customers.create({
      merchantId: merchant.id,
      fullName: 'Vikram Singh',
      phone: '+919999990001',
      retentionExpiresAt: null,
      anonymizedAt: null,
    });

    const app = await stores.applications.create({
      merchantId: merchant.id,
      shopId: shop.id,
      purchaseId: purchase.id,
      customerId: customer.id,
      createdByUserId: null,
      status: 'SUBMITTED',
      routingMode: 'SEQUENTIAL',
      requestedAmountPaise: 7500000n,
      downPaymentPaise: 0n,
      requestedTenureMonths: 6,
      idempotencyKey: 'app-fallback-1',
      submittedAt: new Date(),
      expiresAt: null,
      terminalAt: null,
    });

    // Make Beta approve Vikam by overriding scenario
    adapters.set(
      'LENDER_BETA',
      new MockLenderAdapter({
        code: 'LENDER_BETA',
        displayName: 'Beta',
        fixedScenario: 'APPROVE',
      }),
    );

    const orchestrator = new WaterfallOrchestrator(stores, adapters);
    const finalApp = await orchestrator.execute(app.id);

    expect(finalApp.status).toBe('OFFER_AVAILABLE');

    const attempts = await stores.lenderApplications.listByApplication(app.id);
    expect(attempts.length).toBe(2);
    expect(attempts[0]?.outcome).toBe('DECLINED');
    expect(attempts[1]?.outcome).toBe('OFFERED');
  });

  it('skips lender when its circuit breaker is OPEN and proceeds to fallback', async () => {
    const { stores, merchant, shop, customer, purchase, adapters } = await setup();

    const app = await stores.applications.create({
      merchantId: merchant.id,
      shopId: shop.id,
      purchaseId: purchase.id,
      customerId: customer.id,
      createdByUserId: null,
      status: 'SUBMITTED',
      routingMode: 'SEQUENTIAL',
      requestedAmountPaise: 7500000n,
      downPaymentPaise: 0n,
      requestedTenureMonths: 6,
      idempotencyKey: 'app-cb-1',
      submittedAt: new Date(),
      expiresAt: null,
      terminalAt: null,
    });

    // Pre-trip circuit breaker for Alpha
    const breakers = new Map();
    const alphaBreaker = new CircuitBreaker({ failureThreshold: 1 });
    alphaBreaker.recordFailure(); // trips to OPEN
    breakers.set('LENDER_ALPHA', alphaBreaker);

    const orchestrator = new WaterfallOrchestrator(stores, adapters, { circuitBreakers: breakers });
    const finalApp = await orchestrator.execute(app.id);

    expect(finalApp.status).toBe('OFFER_AVAILABLE');

    const attempts = await stores.lenderApplications.listByApplication(app.id);
    expect(attempts.length).toBe(2);
    expect(attempts[0]?.outcome).toBe('UNAVAILABLE');
    expect(attempts[0]?.errorCode).toBe('CIRCUIT_BREAKER_OPEN');
    expect(attempts[1]?.outcome).toBe('OFFERED');
  });

  it('runs discovery mode and queries lenders concurrently', async () => {
    const { stores, merchant, shop, customer, purchase, adapters } = await setup();

    const app = await stores.applications.create({
      merchantId: merchant.id,
      shopId: shop.id,
      purchaseId: purchase.id,
      customerId: customer.id,
      createdByUserId: null,
      status: 'SUBMITTED',
      routingMode: 'DISCOVERY',
      requestedAmountPaise: 7500000n,
      downPaymentPaise: 0n,
      requestedTenureMonths: 6,
      idempotencyKey: 'app-disc-1',
      submittedAt: new Date(),
      expiresAt: null,
      terminalAt: null,
    });

    const orchestrator = new WaterfallOrchestrator(stores, adapters);
    const finalApp = await orchestrator.execute(app.id);

    expect(finalApp.status).toBe('OFFER_AVAILABLE');

    const attempts = await stores.lenderApplications.listByApplication(app.id);
    expect(attempts.length).toBe(2);

    const offers = await stores.offers.listByApplication(app.id);
    // Both lenders returned offers in discovery mode
    expect(offers.length).toBeGreaterThanOrEqual(2);
  });
});

