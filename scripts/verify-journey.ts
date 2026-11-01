import { buildFullTestApp } from '../tests/helpers/build-full-app';
import request from 'supertest';
import { loadAndValidateFixtures } from '../src/modules/lenders/fixtures/fixture-schema';
import { JsonMockLenderAdapter } from '../src/modules/lenders/adapters/json-mock-lender';

async function verifyJourney() {
  const fixtures = loadAndValidateFixtures();
  console.log('[STEP 1] Validated JSON Fixtures loaded successfully:');
  console.log(' - Lenders count:', fixtures.lenders.length);
  console.log(' - Lenders:', fixtures.lenders.map((l) => l.code).join(', '));
  console.log(
    ' - Global amount range (paise):',
    fixtures.eligibility.globalMinAmountPaise,
    'to',
    fixtures.eligibility.globalMaxAmountPaise,
  );

  const { app, stores } = buildFullTestApp();

  // 0. Register demo lenders in persistent store
  const lAlpha = await stores.lenders.create({
    code: 'LENDER_ALPHA',
    displayName: '[DEMO] Alpha Digital Bank',
    type: 'BANK',
    isSimulated: true,
    status: 'ACTIVE',
  });
  await stores.lenders.saveConfig({
    lenderId: lAlpha.id,
    enabled: true,
    priority: 10,
    minAmountPaise: 100000n,
    maxAmountPaise: 50000000n,
    supportedCategories: ['SMARTPHONE', 'TELEVISION', 'LAPTOP'],
    supportsDiscovery: true,
    fallbackOnDecline: true,
    requestTimeoutMs: 5000,
    maxSafeRetries: 2,
    routingRules: null,
    secretRef: null,
    updatedByUserId: null,
  });

  const lBeta = await stores.lenders.create({
    code: 'LENDER_BETA',
    displayName: '[DEMO] Beta Retail Finance NBFC',
    type: 'NBFC',
    isSimulated: true,
    status: 'ACTIVE',
  });
  await stores.lenders.saveConfig({
    lenderId: lBeta.id,
    enabled: true,
    priority: 20,
    minAmountPaise: 100000n,
    maxAmountPaise: 50000000n,
    supportedCategories: ['SMARTPHONE', 'TELEVISION', 'LAPTOP'],
    supportsDiscovery: true,
    fallbackOnDecline: true,
    requestTimeoutMs: 5000,
    maxSafeRetries: 2,
    routingRules: null,
    secretRef: null,
    updatedByUserId: null,
  });

  // 1. Merchant registration
  const regRes = await request(app).post('/api/v1/auth/register').send({
    email: 'merchant_demo@retail.example',
    password: 'Password123!',
    legalName: 'Demo Retail Electronics',
    tradeName: 'Demo Electronics',
  });
  console.log('[STEP 2] Merchant registration status:', regRes.status, 'ID:', regRes.body.data.merchantId);
  const merchantId = regRes.body.data.merchantId;
  await stores.merchants.updateStatus(merchantId, 'VERIFIED');

  // 2. Merchant login
  const loginRes = await request(app).post('/api/v1/auth/login').send({
    email: 'merchant_demo@retail.example',
    password: 'Password123!',
  });
  const token = loginRes.body.data.tokens.accessToken;
  const authHeaders = { Authorization: 'Bearer ' + token };
  console.log('[STEP 3] Merchant login status:', loginRes.status, 'JWT issued.');

  // 3. Shop creation
  const shopRes = await request(app).post('/api/v1/merchants/shops').set(authHeaders).send({
    name: 'MG Road Flagship Store',
    city: 'Bengaluru',
    state: 'Karnataka',
  });
  const shopId = shopRes.body.data.shop.id;
  console.log('[STEP 4] Shop created:', shopId, shopRes.body.data.shop.name);

  // 4. Customer creation & DPDP consent
  const custRes = await request(app).post('/api/v1/customers').set(authHeaders).send({
    fullName: 'Ananya Deshmukh',
    phone: '+919876543210',
    consentNoticeVersion: 'v1.0-DEMO',
    captureMethod: 'CUSTOMER_CHECKOUT_SESSION',
  });
  const customerId = custRes.body.data.customer.id;
  console.log(
    '[STEP 5] Customer registered:',
    customerId,
    'DPDP Consent granted for FINANCING_APPLICATION_PROCESSING',
  );

  // 5. Purchase creation
  const purchRes = await request(app)
    .post('/api/v1/purchases')
    .set(authHeaders)
    .set('Idempotency-Key', 'purch-demo-tv-001')
    .send({
      shopId,
      customerId,
      productCategory: 'TELEVISION',
      productDescription: 'LG 55 inch OLED 4K Cinema',
      amountPaise: '8500000',
    });
  const purchaseId = purchRes.body.data.purchase.id;
  console.log(
    '[STEP 6] Purchase recorded:',
    purchaseId,
    'Amount (paise):',
    purchRes.body.data.purchase.amountPaise,
  );

  // 6. Checkout session & QR code generation
  const sessionRes = await request(app).post('/api/v1/checkout/sessions').set(authHeaders).send({
    shopId,
    purchaseId,
    validityMinutes: 30,
  });
  const { qrPayload, rawToken } = sessionRes.body.data;
  console.log('[STEP 7] Checkout session generated: Token:', rawToken, 'QR Payload:', qrPayload);

  // 7. Public unauthenticated customer scan
  const scanRes = await request(app).get('/api/v1/checkout/sessions/' + rawToken);
  console.log(
    '[STEP 8] Customer scans QR publicly: HTTP',
    scanRes.status,
    'Purchase Amount:',
    scanRes.body.data.purchase.amountPaise,
  );

  // 8. Eligibility assessment
  const demoAdapter = new JsonMockLenderAdapter({
    code: 'DEMO_BANK_ALPHA',
    displayName: '[DEMO] Alpha Digital Bank',
    fixtures,
  });
  const elig = await demoAdapter.checkEligibility({
    merchantId,
    customer: { fullName: 'Ananya Deshmukh', phone: '+919876543210' },
    productCategory: 'TELEVISION',
    amountPaise: 8500000n,
  });
  console.log(
    '[STEP 9] Eligibility Assessment result:',
    elig.eligible ? 'ELIGIBLE' : 'INELIGIBLE',
    'Max limit:',
    elig.maxAmountPaise,
  );

  // 9. Financing Application creation
  const appRes = await request(app).post('/api/v1/applications').set(authHeaders).send({
    shopId,
    purchaseId,
    customerId,
    requestedAmountPaise: '8500000',
    downPaymentPaise: '0',
    requestedTenureMonths: 6,
    routingMode: 'SEQUENTIAL',
  });
  const applicationId = appRes.body.data.application.id;
  console.log(
    '[STEP 10] Application created:',
    applicationId,
    'Initial Status:',
    appRes.body.data.application.status,
  );

  // 10. Application submission -> Waterfall Orchestration
  const submitRes = await request(app)
    .post('/api/v1/applications/' + applicationId + '/submit')
    .set(authHeaders);
  console.log(
    '[STEP 11] Application submitted to waterfall: Resulting Status:',
    submitRes.body.data.application.status,
  );

  // 11. Multi-offer retrieval & comparison
  const offersRes = await request(app)
    .get('/api/v1/applications/' + applicationId + '/offers')
    .set(authHeaders);
  console.log('[STEP 12] Offers retrieved:', offersRes.body.data.length, 'active offer(s):');
  for (const offer of offersRes.body.data) {
    console.log(
      '   - Ref:',
      offer.lenderOfferReference,
      'Tenure:',
      offer.tenureMonths + 'M',
      'EMI (paise):',
      offer.emiPaise,
      'Rate:',
      offer.interestRatePercent + '%',
      'isSimulated:',
      offer.isSimulated,
    );
  }

  // 12. Simulated offer acceptance
  const selectedOffer = offersRes.body.data[0];
  const acceptRes = await request(app)
    .post('/api/v1/applications/' + applicationId + '/offers/' + selectedOffer.id + '/accept')
    .set(authHeaders);
  console.log('[STEP 13] Customer accepts simulated offer:', selectedOffer.id);
  console.log('   - Application Status:', acceptRes.body.data.applicationStatus);
  console.log('   - Offer Status:', acceptRes.body.data.offer.status);

  // 13. Audit Status History
  const historyRes = await request(app)
    .get('/api/v1/applications/' + applicationId + '/history')
    .set(authHeaders);
  console.log('[STEP 14] Audit Status History transitions:');
  for (const h of historyRes.body.data.history) {
    console.log(
      '   - ' + (h.fromStatus || 'INIT') + ' -> ' + h.toStatus + ' (by ' + h.actorType + ')',
    );
  }
}

verifyJourney().catch((err) => {
  console.error('Journey failed:', err);
  process.exit(1);
});
