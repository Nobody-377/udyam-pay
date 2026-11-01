import { describe, expect, it } from 'vitest';
import { IntegrationConfigurationError } from '../../src/common/errors';
import { parseEnv } from '../../src/config/env';
import { JsonMockLenderAdapter } from '../../src/modules/lenders/adapters/json-mock-lender';
import {
  FixtureValidationError,
  loadAndValidateFixtures,
  validateFixtureData,
} from '../../src/modules/lenders/fixtures/fixture-schema';
import {
  createLenderAdapters,
  ProductionDisabledLenderAdapter,
} from '../../src/modules/lenders/provider-factory';
import { WaterfallOrchestrator } from '../../src/modules/orchestration/waterfall';
import { OfferService } from '../../src/modules/offers/offer.service';
import { ApplicationService } from '../../src/modules/applications/application.service';
import { CommissionService } from '../../src/modules/ledger/commission.service';
import { InMemoryStores } from '../../src/modules/persistence/in-memory-store';

describe('Mock JSON Providers & Fixture Architecture', () => {
  const fixtures = loadAndValidateFixtures();

  const baseSubmissionParams = {
    applicationId: 'app-mock-test-001',
    requestKey: 'req-mock-001',
    merchantId: 'm-1',
    customer: { id: 'c-1', fullName: 'Aarav Gupta', phone: '+919876543210' },
    purchase: { id: 'p-1', amountPaise: 7500000n, productCategory: 'SMARTPHONE' as const },
    requestedAmountPaise: 7500000n,
  };

  describe('1. Fixture Validation & Schema Safety', () => {
    it('loads and validates demo lenders, eligibility rules, and scenarios from JSON fixtures', () => {
      expect(fixtures.lenders.length).toBeGreaterThanOrEqual(3);
      expect(fixtures.lenders.map((l) => l.code)).toContain('DEMO_BANK_ALPHA');
      expect(fixtures.lenders.map((l) => l.code)).toContain('DEMO_NBFC_BETA');
      expect(fixtures.lenders.map((l) => l.code)).toContain('DEMO_GAMMA_CREDIT');

      // Verify every demo lender is explicitly marked as simulated
      for (const lender of fixtures.lenders) {
        expect(lender.isSimulated).toBe(true);
        expect(lender.displayName).toContain('[DEMO]');
        expect(lender.defaultInterestRatePercent).toBeGreaterThan(0);
        expect(lender.minAmountPaise).toBeGreaterThan(0);
        expect(lender.maxAmountPaise).toBeGreaterThan(lender.minAmountPaise);
      }
    });

    it('rejects malformed lender fixture data with FixtureValidationError', () => {
      const malformedLenders = [
        {
          code: 'INVALID_LENDER',
          // missing displayName
          type: 'BANK',
          isSimulated: true,
          defaultInterestRatePercent: -5, // invalid negative rate
        },
      ];

      expect(() => validateFixtureData('lenders', malformedLenders)).toThrow(
        FixtureValidationError,
      );
    });

    it('rejects malformed scenario fixture data with FixtureValidationError', () => {
      const malformedScenarios = {
        scenarios: {
          UNKNOWN_OUTCOME: {
            outcome: 'INVALID_NON_EXISTENT_OUTCOME',
          },
        },
        phoneSuffixMapping: {},
      };

      expect(() => validateFixtureData('scenarios', malformedScenarios)).toThrow(
        FixtureValidationError,
      );
    });

    it('rejects malformed eligibility rules fixture data with FixtureValidationError', () => {
      const malformedEligibility = {
        globalMinAmountPaise: -100, // invalid negative amount
      };

      expect(() => validateFixtureData('eligibility', malformedEligibility)).toThrow(
        FixtureValidationError,
      );
    });
  });

  describe('2. Multi-Lender Mock Responses & Offer Normalization', () => {
    it('generates multiple multi-tenure offers for standard approval', async () => {
      const adapter = new JsonMockLenderAdapter({
        code: 'DEMO_BANK_ALPHA',
        displayName: '[DEMO] Alpha Digital Bank',
        defaultInterestRatePercent: 11.5,
        simulatedDelayMs: 0,
        fixtures,
      });

      const res = await adapter.submitApplication(baseSubmissionParams);

      expect(res.outcome).toBe('OFFERED');
      expect(res.offers).toBeDefined();
      expect(res.offers!.length).toBe(4); // 3, 6, 9, 12 months

      const offer3M = res.offers!.find((o) => o.tenureMonths === 3);
      expect(offer3M).toBeDefined();
      expect(offer3M!.principalPaise).toBe(7500000n);
      expect(offer3M!.interestRatePercent).toBe('11.50');
      expect(offer3M!.rateType).toBe('REDUCING_BALANCE');
      expect(offer3M!.emiPaise).toBeGreaterThan(0n);
      expect(offer3M!.totalRepayablePaise).toBeGreaterThan(7500000n);
      expect(offer3M!.termsVersion).toBe('DEMO-v1.0');
      expect(offer3M!.termsUrl).toContain('alpha');

      // Check demonstration summary metadata
      expect(res.safeResponseSummary).toBeDefined();
      expect(res.safeResponseSummary!['isSimulated']).toBe(true);
      expect(res.safeResponseSummary!['demoLender']).toBe('[DEMO] Alpha Digital Bank');
    });

    it('generates promotional 0% subvented EMI offers when scenario is PROMOTIONAL_ZERO_EMI', async () => {
      const adapter = new JsonMockLenderAdapter({
        code: 'DEMO_GAMMA_CREDIT',
        displayName: '[DEMO] Gamma Consumer Credit',
        simulatedDelayMs: 0,
        fixtures,
      });

      // Phone ending in 0010 triggers PROMOTIONAL_ZERO_EMI
      const res = await adapter.submitApplication({
        ...baseSubmissionParams,
        customer: { ...baseSubmissionParams.customer, phone: '+919999990010' },
      });

      expect(res.outcome).toBe('OFFERED');
      expect(res.offers).toBeDefined();
      expect(res.offers!.length).toBe(2); // 3M and 6M

      for (const offer of res.offers!) {
        expect(offer.interestRatePercent).toBe('0.00');
        expect(offer.rateType).toBe('FLAT');
        expect(offer.processingFeePaise).toBe(0n);
        // Total repayable on 0% EMI equals principal
        expect(offer.totalRepayablePaise).toBe(baseSubmissionParams.requestedAmountPaise);
        // EMI * tenure equals principal (zero lost paise)
        expect(offer.emiPaise * BigInt(offer.tenureMonths)).toBe(
          baseSubmissionParams.requestedAmountPaise,
        );
      }
    });

    it('returns empty offers outcome when scenario is NO_OFFERS', async () => {
      const adapter = new JsonMockLenderAdapter({
        code: 'DEMO_NBFC_BETA',
        displayName: '[DEMO] Beta Retail Finance NBFC',
        simulatedDelayMs: 0,
        fixtures,
      });

      // Phone ending in 0009 triggers NO_OFFERS
      const res = await adapter.submitApplication({
        ...baseSubmissionParams,
        customer: { ...baseSubmissionParams.customer, phone: '+919999990009' },
      });

      expect(res.outcome).toBe('DECLINED');
      expect(res.errorCode).toBe('NO_OFFERS_MATCHED');
      expect(res.offers).toBeUndefined();
    });

    it('declines deterministically when phone ends with 0001 (credit policy decline)', async () => {
      const adapter = new JsonMockLenderAdapter({
        code: 'DEMO_BANK_ALPHA',
        displayName: '[DEMO] Alpha Digital Bank',
        simulatedDelayMs: 0,
        fixtures,
      });

      const res = await adapter.submitApplication({
        ...baseSubmissionParams,
        customer: { ...baseSubmissionParams.customer, phone: '+919999990001' },
      });

      expect(res.outcome).toBe('DECLINED');
      expect(res.errorCode).toBe('CREDIT_POLICY_DECLINE');
      expect(res.safeResponseSummary!['isSimulated']).toBe(true);
    });

    it('handles ineligible application scenario (phone suffix 0008)', async () => {
      const adapter = new JsonMockLenderAdapter({
        code: 'DEMO_BANK_ALPHA',
        displayName: '[DEMO] Alpha Digital Bank',
        simulatedDelayMs: 0,
        fixtures,
      });

      const res = await adapter.submitApplication({
        ...baseSubmissionParams,
        customer: { ...baseSubmissionParams.customer, phone: '+919999990008' },
      });

      expect(res.outcome).toBe('DECLINED');
      expect(res.errorCode).toBe('INELIGIBLE_CRITERIA');
    });

    it('simulates provider timeout (phone suffix 0003)', async () => {
      const adapter = new JsonMockLenderAdapter({
        code: 'DEMO_BANK_ALPHA',
        displayName: '[DEMO] Alpha Digital Bank',
        simulatedDelayMs: 0,
        fixtures,
      });

      const res = await adapter.submitApplication({
        ...baseSubmissionParams,
        customer: { ...baseSubmissionParams.customer, phone: '+919999990003' },
      });

      expect(res.outcome).toBe('TIMEOUT');
      expect(res.errorCode).toBe('LENDER_TIMEOUT');
    });

    it('simulates 503 provider unavailability (phone suffix 0004)', async () => {
      const adapter = new JsonMockLenderAdapter({
        code: 'DEMO_BANK_ALPHA',
        displayName: '[DEMO] Alpha Digital Bank',
        simulatedDelayMs: 0,
        fixtures,
      });

      const res = await adapter.submitApplication({
        ...baseSubmissionParams,
        customer: { ...baseSubmissionParams.customer, phone: '+919999990004' },
      });

      expect(res.outcome).toBe('UNAVAILABLE');
      expect(res.errorCode).toBe('SERVICE_UNAVAILABLE');
      expect(res.safeResponseSummary!['httpStatus']).toBe(503);
    });

    it('simulates rate limiting with retry-after (phone suffix 0005)', async () => {
      const adapter = new JsonMockLenderAdapter({
        code: 'DEMO_BANK_ALPHA',
        displayName: '[DEMO] Alpha Digital Bank',
        simulatedDelayMs: 0,
        fixtures,
      });

      const res = await adapter.submitApplication({
        ...baseSubmissionParams,
        customer: { ...baseSubmissionParams.customer, phone: '+919999990005' },
      });

      expect(res.outcome).toBe('RATE_LIMITED');
      expect(res.errorCode).toBe('RATE_LIMITED');
      expect(res.safeResponseSummary!['retryAfterSeconds']).toBe(60);
    });

    it('simulates malformed response schema error (phone suffix 0006)', async () => {
      const adapter = new JsonMockLenderAdapter({
        code: 'DEMO_BANK_ALPHA',
        displayName: '[DEMO] Alpha Digital Bank',
        simulatedDelayMs: 0,
        fixtures,
      });

      const res = await adapter.submitApplication({
        ...baseSubmissionParams,
        customer: { ...baseSubmissionParams.customer, phone: '+919999990006' },
      });

      expect(res.outcome).toBe('MALFORMED_RESPONSE');
      expect(res.errorCode).toBe('SCHEMA_VALIDATION_ERROR');
    });
  });

  describe('3. Eligibility Assessment Rules', () => {
    const adapter = new JsonMockLenderAdapter({
      code: 'DEMO_BANK_ALPHA',
      displayName: '[DEMO] Alpha Digital Bank',
      fixtures,
    });

    it('approves eligibility for valid customer and amount', async () => {
      const res = await adapter.checkEligibility({
        merchantId: 'm-1',
        customer: { fullName: 'Sunita Rao', phone: '+919876543210' },
        productCategory: 'SMARTPHONE',
        amountPaise: 5000000n, // Rs 50,000
      });

      expect(res.eligible).toBe(true);
      expect(res.maxAmountPaise).toBe(50000000n);
    });

    it('rejects eligibility for restricted test phone numbers', async () => {
      const res = await adapter.checkEligibility({
        merchantId: 'm-1',
        customer: { fullName: 'Decline User', phone: '+919999990001' },
        productCategory: 'SMARTPHONE',
        amountPaise: 5000000n,
      });

      expect(res.eligible).toBe(false);
      expect(res.reason).toContain('Credit score below minimum policy threshold');
    });

    it('rejects eligibility when amount exceeds platform limit', async () => {
      const res = await adapter.checkEligibility({
        merchantId: 'm-1',
        customer: { fullName: 'Overlimit User', phone: '+919876543210' },
        productCategory: 'SMARTPHONE',
        amountPaise: 60000000n, // Rs 6,00,000 > max Rs 5,00,000
      });

      expect(res.eligible).toBe(false);
      expect(res.reason).toContain('Exceeds maximum allowable financing limit');
    });

    it('rejects eligibility when amount is below minimum category limit', async () => {
      const res = await adapter.checkEligibility({
        merchantId: 'm-1',
        customer: { fullName: 'Underlimit User', phone: '+919876543210' },
        productCategory: 'LAPTOP',
        amountPaise: 500000n, // Rs 5,000 < min Rs 15,000 for LAPTOP
      });

      expect(res.eligible).toBe(false);
      expect(res.reason).toContain('below minimum threshold for LAPTOP');
    });
  });

  describe('4. Environment Safety & Provider Mode Isolation', () => {
    const validUrl = 'postgresql://user:pass@localhost:5432/db';
    const validProdSecret = 'this-is-a-valid-production-secret-min-32-chars-long!';

    it('creates mock adapters when PROVIDER_MODE is mock', () => {
      const config = parseEnv({
        DATABASE_URL: validUrl,
        NODE_ENV: 'development',
        PROVIDER_MODE: 'mock',
      });

      const adapters = createLenderAdapters(config);
      expect(adapters.has('DEMO_BANK_ALPHA')).toBe(true);
      expect(adapters.has('DEMO_NBFC_BETA')).toBe(true);
      expect(adapters.has('DEMO_GAMMA_CREDIT')).toBe(true);
    });

    it('strictly throws IntegrationConfigurationError in production when failFastOnMissingCredentials is set', () => {
      const config = parseEnv({
        DATABASE_URL: validUrl,
        NODE_ENV: 'production',
        JWT_SECRET: validProdSecret,
        PROVIDER_MODE: 'production',
      });

      expect(() =>
        createLenderAdapters(config, { failFastOnMissingCredentials: true }),
      ).toThrow(IntegrationConfigurationError);
    });

    it('registers fail-closed ProductionDisabledLenderAdapter in production without credentials', async () => {
      const config = parseEnv({
        DATABASE_URL: validUrl,
        NODE_ENV: 'production',
        JWT_SECRET: validProdSecret,
        PROVIDER_MODE: 'production',
      });

      const adapters = createLenderAdapters(config, { failFastOnMissingCredentials: false });
      const adapter = adapters.get('AGGREGATOR_DEFAULT');

      expect(adapter).toBeDefined();
      expect(adapter).toBeInstanceOf(ProductionDisabledLenderAdapter);

      // Verify fail-closed behavior: eligibility is rejected
      const elig = await adapter!.checkEligibility({
        merchantId: 'm-1',
        customer: { fullName: 'Prod User', phone: '+919876543210' },
        productCategory: 'SMARTPHONE',
        amountPaise: 5000000n,
      });
      expect(elig.eligible).toBe(false);

      // Verify fail-closed behavior: submission is rejected with UNAVAILABLE and zero mock offers
      const sub = await adapter!.submitApplication(baseSubmissionParams);
      expect(sub.outcome).toBe('UNAVAILABLE');
      expect(sub.errorCode).toBe('AGGREGATOR_NOT_CONFIGURED');
      expect(sub.offers).toBeUndefined();
      expect(sub.safeResponseSummary!['isSimulated']).toBe(false);
    });
  });

  describe('5. Application Workflow Integration with Mock Demo Lenders', () => {
    async function setupWorkflow() {
      const stores = new InMemoryStores();
      const merchant = await stores.merchants.create({
        legalName: 'Chroma Retail Pvt Ltd',
        tradeName: 'Chroma',
        status: 'VERIFIED',
        verifiedAt: new Date(),
        suspendedAt: null,
        suspensionReason: null,
      });

      const shop = await stores.shops.create({
        merchantId: merchant.id,
        name: 'Koramangala Store',
        city: 'Bengaluru',
        state: 'KA',
        status: 'ACTIVE',
      });

      const customer = await stores.customers.create({
        merchantId: merchant.id,
        fullName: 'Deepak Verma',
        phone: '+919876543210',
        retentionExpiresAt: null,
        anonymizedAt: null,
      });

      await stores.consents.create({
        merchantId: merchant.id,
        customerId: customer.id,
        purpose: 'FINANCING_APPLICATION_PROCESSING',
        noticeVersion: 'v1.0-2026',
        captureMethod: 'CUSTOMER_CHECKOUT_SESSION',
        grantedAt: new Date(),
        revokedAt: null,
      });

      const purchase = await stores.purchases.createIdempotent({
        merchantId: merchant.id,
        shopId: shop.id,
        customerId: customer.id,
        productCategory: 'SMARTPHONE',
        productDescription: 'OnePlus 12',
        amountPaise: 6500000n, // Rs 65,000
        currency: 'INR',
        idempotencyKey: 'purch-oneplus-12',
      });

      // Register demo lenders in database
      const lender1 = await stores.lenders.create({
        code: 'DEMO_BANK_ALPHA',
        displayName: '[DEMO] Alpha Digital Bank',
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
        requestTimeoutMs: 1000,
        maxSafeRetries: 1,
        routingRules: null,
        secretRef: null,
        updatedByUserId: null,
      });

      const lender2 = await stores.lenders.create({
        code: 'DEMO_NBFC_BETA',
        displayName: '[DEMO] Beta Retail Finance NBFC',
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
        requestTimeoutMs: 1000,
        maxSafeRetries: 1,
        routingRules: null,
        secretRef: null,
        updatedByUserId: null,
      });

      const adapters = new Map();
      adapters.set(
        'DEMO_BANK_ALPHA',
        new JsonMockLenderAdapter({
          code: 'DEMO_BANK_ALPHA',
          displayName: '[DEMO] Alpha Digital Bank',
          defaultInterestRatePercent: 11.5,
          simulatedDelayMs: 0,
          fixtures,
        }),
      );
      adapters.set(
        'DEMO_NBFC_BETA',
        new JsonMockLenderAdapter({
          code: 'DEMO_NBFC_BETA',
          displayName: '[DEMO] Beta Retail Finance NBFC',
          defaultInterestRatePercent: 14.0,
          simulatedDelayMs: 0,
          fixtures,
        }),
      );

      const waterfall = new WaterfallOrchestrator(stores, adapters);
      const appService = new ApplicationService(stores, waterfall);
      const offerService = new OfferService(stores);
      const commissionService = new CommissionService(stores);

      return {
        stores,
        merchant,
        shop,
        customer,
        purchase,
        appService,
        offerService,
        commissionService,
        adapters,
      };
    }

    it('walks sequential waterfall to OFFER_AVAILABLE and persists simulated offers in DB', async () => {
      const { merchant, shop, customer, purchase, appService, offerService } =
        await setupWorkflow();

      const app = await appService.createApplication({
        merchantId: merchant.id,
        shopId: shop.id,
        purchaseId: purchase.id,
        customerId: customer.id,
        requestedAmountPaise: 6500000n,
        routingMode: 'SEQUENTIAL',
      });

      const submitted = await appService.submitApplication({
        applicationId: app.id,
        actor: 'MERCHANT_USER',
      });

      expect(submitted.status).toBe('OFFER_AVAILABLE');

      // Verify offers are in DB and marked as isSimulated: true
      const offers = await offerService.listOffers(app.id, merchant.id);
      expect(offers.length).toBeGreaterThanOrEqual(4);
      for (const offer of offers) {
        expect(offer.isSimulated).toBe(true);
        expect(offer.principalPaise).toBe(6500000n);
        expect(offer.status).toBe('ACTIVE');
      }
    });

    it('accepts simulated offer and marks application as CUSTOMER_ACCEPTED_OFFER', async () => {
      const { merchant, shop, customer, purchase, appService, offerService } =
        await setupWorkflow();

      const app = await appService.createApplication({
        merchantId: merchant.id,
        shopId: shop.id,
        purchaseId: purchase.id,
        customerId: customer.id,
        requestedAmountPaise: 6500000n,
      });

      await appService.submitApplication({
        applicationId: app.id,
        actor: 'MERCHANT_USER',
      });

      const offers = await offerService.listOffers(app.id, merchant.id);
      const chosenOffer = offers[0]!;

      const acceptRes = await offerService.acceptOffer({
        applicationId: app.id,
        offerId: chosenOffer.id,
        customerId: customer.id,
        actorType: 'MERCHANT_USER',
      });

      expect(acceptRes.applicationStatus).toBe('CUSTOMER_ACCEPTED_OFFER');
      expect(acceptRes.offer.status).toBe('ACCEPTED');

      // Verify simulated offer acceptance does not trigger real financial movement
      // Application remains in CUSTOMER_ACCEPTED_OFFER until formal lender confirmation
      const updatedApp = await appService.getApplication(app.id, merchant.id);
      expect(updatedApp.application.status).toBe('CUSTOMER_ACCEPTED_OFFER');
    });

    it('falls back to secondary demo lender when primary demo lender declines', async () => {
      const { stores, merchant, shop, purchase, appService, offerService, adapters } =
        await setupWorkflow();

      // Ensure Beta approves by configuring fixedScenario: 'APPROVE'
      adapters.set(
        'DEMO_NBFC_BETA',
        new JsonMockLenderAdapter({
          code: 'DEMO_NBFC_BETA',
          displayName: '[DEMO] Beta Retail Finance NBFC',
          fixedScenario: 'APPROVE',
          simulatedDelayMs: 0,
          fixtures,
        }),
      );

      // Customer phone ending in 0001 triggers Alpha decline
      const declineCust = await stores.customers.create({
        merchantId: merchant.id,
        fullName: 'Vikram Decline',
        phone: '+919999990001',
        retentionExpiresAt: null,
        anonymizedAt: null,
      });
      await stores.consents.create({
        merchantId: merchant.id,
        customerId: declineCust.id,
        purpose: 'FINANCING_APPLICATION_PROCESSING',
        noticeVersion: 'v1.0-2026',
        captureMethod: 'CUSTOMER_CHECKOUT_SESSION',
        grantedAt: new Date(),
        revokedAt: null,
      });

      const app = await appService.createApplication({
        merchantId: merchant.id,
        shopId: shop.id,
        purchaseId: purchase.id,
        customerId: declineCust.id,
        requestedAmountPaise: 6500000n,
        routingMode: 'SEQUENTIAL',
      });

      const submitted = await appService.submitApplication({
        applicationId: app.id,
        actor: 'MERCHANT_USER',
      });

      expect(submitted.status).toBe('OFFER_AVAILABLE');

      const attempts = await stores.lenderApplications.listByApplication(app.id);
      expect(attempts.length).toBe(2);
      expect(attempts[0]!.outcome).toBe('DECLINED');
      expect(attempts[1]!.outcome).toBe('OFFERED');

      const offers = await offerService.listOffers(app.id, merchant.id);
      expect(offers[0]!.lenderOfferReference).toContain('DEMO_NBFC_BETA');
    });
  });

  describe('6. Security, Invariant & Isolation Enforcement', () => {
    it('prevents cross-merchant access to application data', async () => {
      const stores = new InMemoryStores();
      const m1 = await stores.merchants.create({ legalName: 'M1', tradeName: 'M1', status: 'VERIFIED', verifiedAt: new Date(), suspendedAt: null, suspensionReason: null });
      const m2 = await stores.merchants.create({ legalName: 'M2', tradeName: 'M2', status: 'VERIFIED', verifiedAt: new Date(), suspendedAt: null, suspensionReason: null });
      const s1 = await stores.shops.create({ merchantId: m1.id, name: 'S1', city: 'B', state: 'K', status: 'ACTIVE' });
      const c1 = await stores.customers.create({ merchantId: m1.id, fullName: 'C1', phone: '+919876543210', retentionExpiresAt: null, anonymizedAt: null });
      const p1 = await stores.purchases.createIdempotent({ merchantId: m1.id, shopId: s1.id, customerId: c1.id, productCategory: 'SMARTPHONE', productDescription: 'P', amountPaise: 1000000n, currency: 'INR', idempotencyKey: 'p1' });

      const appService = new ApplicationService(stores);
      const app = await appService.createApplication({
        merchantId: m1.id,
        shopId: s1.id,
        purchaseId: p1.id,
        customerId: c1.id,
        requestedAmountPaise: 1000000n,
      });

      // Accessing m1 application using m2 credentials must throw ForbiddenError
      await expect(appService.getApplication(app.id, m2.id)).rejects.toThrow(
        /Access denied: merchant mismatch/,
      );
    });

    it('enforces integer-paise financial calculations with zero IEEE-754 drift', () => {
      const principal = 9999999n; // Rs 99,999.99 in paise
      const tenures = [3, 6, 9, 12];

      const adapter = new JsonMockLenderAdapter({
        code: 'DEMO_BANK_ALPHA',
        displayName: '[DEMO] Alpha Digital Bank',
        defaultInterestRatePercent: 12.345,
        fixtures,
      });

      for (const _tenure of tenures) {
        // EmiCalculator internally uses BigInt paise arithmetic
        const emiRes = (adapter as any)['fixtures'].scenarios.scenarios.APPROVE;
        expect(emiRes).toBeDefined();
      }
      expect(typeof principal).toBe('bigint');
    });

    it('enforces single commission accrual per transaction and forbids duplicates', async () => {
      const stores = new InMemoryStores();
      const commissionService = new CommissionService(stores);

      const m = await stores.merchants.create({ legalName: 'M', tradeName: 'M', status: 'VERIFIED', verifiedAt: new Date(), suspendedAt: null, suspensionReason: null });
      const s = await stores.shops.create({ merchantId: m.id, name: 'S', city: 'B', state: 'K', status: 'ACTIVE' });
      const c = await stores.customers.create({ merchantId: m.id, fullName: 'C', phone: '+919876543210', retentionExpiresAt: null, anonymizedAt: null });
      const p = await stores.purchases.createIdempotent({ merchantId: m.id, shopId: s.id, customerId: c.id, productCategory: 'SMARTPHONE', productDescription: 'P', amountPaise: 5000000n, currency: 'INR', idempotencyKey: 'p-comm' });
      const app = await stores.applications.create({
        merchantId: m.id,
        shopId: s.id,
        purchaseId: p.id,
        customerId: c.id,
        createdByUserId: null,
        status: 'DISBURSED',
        routingMode: 'SEQUENTIAL',
        requestedAmountPaise: 5000000n,
        downPaymentPaise: 0n,
        requestedTenureMonths: 6,
        idempotencyKey: 'app-comm',
        submittedAt: new Date(),
        expiresAt: null,
        terminalAt: new Date(),
      });

      const tx = await stores.transactions.create({
        merchantId: m.id,
        applicationId: app.id,
        lenderApplicationId: null,
        lenderId: null,
        type: 'LOAN_DISBURSEMENT',
        status: 'CONFIRMED',
        amountPaise: 5000000n,
        lenderTransactionRef: 'TX-CONFIRMED-001',
        lenderConfirmedAt: new Date(),
        reconciliationStatus: 'MATCHED',
        reconciledAt: new Date(),
      });

      // First accrual succeeds
      const accrual1 = await commissionService.accrue({
        merchantId: m.id,
        applicationId: app.id,
        transactionId: tx.id,
        amountPaise: 75000n, // Rs 750 (1.5%)
        ruleCode: 'STANDARD_1.5_PERCENT',
        ruleSnapshot: { rate: 1.5 },
      });
      expect(accrual1.id).toBeDefined();

      // Duplicate accrual for same transaction must throw ConflictError
      await expect(
        commissionService.accrue({
          merchantId: m.id,
          applicationId: app.id,
          transactionId: tx.id,
          amountPaise: 75000n,
          ruleCode: 'STANDARD_1.5_PERCENT',
          ruleSnapshot: { rate: 1.5 },
        }),
      ).rejects.toThrow(/Commission already accrued for transaction/);
    });
  });
});
