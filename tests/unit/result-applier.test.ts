import { describe, expect, it } from 'vitest';
import { ResultApplier } from '../../src/modules/orchestration/result-applier';
import { InMemoryStores } from '../../src/modules/persistence/in-memory-store';

describe('ResultApplier', () => {
  async function setup() {
    const stores = new InMemoryStores();
    const merchant = await stores.merchants.create({
      legalName: 'Test Retailer',
      tradeName: 'Test Shop',
      status: 'VERIFIED',
      verifiedAt: new Date(),
      suspendedAt: null,
      suspensionReason: null,
    });
    const shop = await stores.shops.create({
      merchantId: merchant.id,
      name: 'Main Branch',
      city: 'Mumbai',
      state: 'MH',
      status: 'ACTIVE',
    });
    const customer = await stores.customers.create({
      merchantId: merchant.id,
      fullName: 'Asha Verma',
      phone: '+919876543210',
      retentionExpiresAt: null,
      anonymizedAt: null,
    });
    const purchase = await stores.purchases.createIdempotent({
      merchantId: merchant.id,
      shopId: shop.id,
      customerId: customer.id,
      productCategory: 'TELEVISION',
      productDescription: 'Sony Bravia 55',
      amountPaise: 6000000n,
      currency: 'INR',
      idempotencyKey: 'purch-1',
    });
    const app = await stores.applications.create({
      merchantId: merchant.id,
      shopId: shop.id,
      purchaseId: purchase.id,
      customerId: customer.id,
      createdByUserId: null,
      status: 'LENDER_PROCESSING',
      routingMode: 'SEQUENTIAL',
      requestedAmountPaise: 6000000n,
      downPaymentPaise: 0n,
      requestedTenureMonths: 6,
      idempotencyKey: 'app-1',
      submittedAt: new Date(),
      expiresAt: null,
      terminalAt: null,
    });
    const lender = await stores.lenders.create({
      code: 'LENDER_ALPHA',
      displayName: 'Alpha Finance',
      type: 'NBFC',
      isSimulated: true,
      status: 'ACTIVE',
    });
    const lenderApp = await stores.lenderApplications.create({
      applicationId: app.id,
      merchantId: merchant.id,
      lenderId: lender.id,
      attemptNo: 1,
      requestKey: 'req-alpha-1',
      externalReference: null,
      outcome: 'PENDING',
      errorCode: null,
      responseHash: null,
      safeResponseSummary: null,
      reconcileAttempts: 0,
      startedAt: new Date(),
      completedAt: null,
      latencyMs: null,
    });

    const applier = new ResultApplier(stores);
    return { stores, merchant, customer, purchase, app, lender, lenderApp, applier };
  }

  it('applies OFFERED outcome, persists offers, and transitions application to OFFER_AVAILABLE', async () => {
    const { app, lender, lenderApp, applier, stores } = await setup();

    const outcome = await applier.apply({
      application: app,
      lenderApplication: lenderApp,
      lender,
      result: {
        outcome: 'OFFERED',
        externalReference: 'EXT-123',
        offers: [
          {
            lenderOfferReference: 'OFR-1',
            principalPaise: 6000000n,
            tenureMonths: 6,
            interestRatePercent: '12.00',
            rateType: 'REDUCING_BALANCE',
            aprPercent: '13.50',
            emiPaise: 1035000n,
          },
        ],
      },
      isFinalLenderInWaterfall: false,
    });

    expect(outcome.appliedStatus).toBe('OFFER_AVAILABLE');
    expect(outcome.duplicateOrStale).toBe(false);

    const savedOffers = await stores.offers.listByApplication(app.id);
    expect(savedOffers.length).toBe(1);
    expect(savedOffers[0]?.emiPaise).toBe(1035000n);

    const updatedLenderApp = await stores.lenderApplications.findById(lenderApp.id);
    expect(updatedLenderApp?.outcome).toBe('OFFERED');
  });

  it('intermediate lender decline does not decline the application', async () => {
    const { app, lender, lenderApp, applier, stores } = await setup();

    const outcome = await applier.apply({
      application: app,
      lenderApplication: lenderApp,
      lender,
      result: {
        outcome: 'DECLINED',
        errorCode: 'CREDIT_POLICY_DECLINE',
      },
      isFinalLenderInWaterfall: false,
    });

    // Remains in LENDER_PROCESSING for fallback lender
    expect(outcome.appliedStatus).toBe('LENDER_PROCESSING');

    const freshApp = await stores.applications.findById(app.id);
    expect(freshApp?.status).toBe('LENDER_PROCESSING');
  });

  it('final lender decline transitions application to DECLINED', async () => {
    const { app, lender, lenderApp, applier, stores } = await setup();

    const outcome = await applier.apply({
      application: app,
      lenderApplication: lenderApp,
      lender,
      result: {
        outcome: 'DECLINED',
        errorCode: 'CREDIT_POLICY_DECLINE',
      },
      isFinalLenderInWaterfall: true,
    });

    expect(outcome.appliedStatus).toBe('DECLINED');

    const freshApp = await stores.applications.findById(app.id);
    expect(freshApp?.status).toBe('DECLINED');
    expect(freshApp?.terminalAt).toBeTruthy();
  });

  it('final technical failure transitions to TECHNICAL_FAILURE, not DECLINED', async () => {
    const { app, lender, lenderApp, applier, stores } = await setup();

    const outcome = await applier.apply({
      application: app,
      lenderApplication: lenderApp,
      lender,
      result: {
        outcome: 'TIMEOUT',
        errorCode: 'LENDER_TIMEOUT',
      },
      isFinalLenderInWaterfall: true,
    });

    expect(outcome.appliedStatus).toBe('TECHNICAL_FAILURE');

    const freshApp = await stores.applications.findById(app.id);
    expect(freshApp?.status).toBe('TECHNICAL_FAILURE');
  });

  it('ignores duplicate results arriving after customer accepted an offer', async () => {
    const { app, lender, lenderApp, applier, stores } = await setup();

    // Transition application to CUSTOMER_ACCEPTED_OFFER
    await stores.applications.updateStatus({
      id: app.id,
      expectedVersion: app.version,
      toStatus: 'OFFER_AVAILABLE',
      actorType: 'SYSTEM',
    });
    const acceptedApp = await stores.applications.updateStatus({
      id: app.id,
      expectedVersion: app.version + 1,
      toStatus: 'CUSTOMER_ACCEPTED_OFFER',
      actorType: 'MERCHANT_USER',
    });

    const outcome = await applier.apply({
      application: acceptedApp,
      lenderApplication: lenderApp,
      lender,
      result: {
        outcome: 'DECLINED',
      },
      isFinalLenderInWaterfall: true,
    });

    expect(outcome.duplicateOrStale).toBe(true);
    expect(outcome.appliedStatus).toBe('CUSTOMER_ACCEPTED_OFFER');
  });
});

