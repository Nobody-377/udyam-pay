import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { buildFullTestApp } from '../helpers/build-full-app';

describe('Main Business Flow End-to-End', () => {
  it('walks the complete lifecycle from onboarding to disbursement and commission ledger', async () => {
    const { app, stores } = buildFullTestApp();

    // Configure lenders in store
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
      requestTimeoutMs: 5000,
      maxSafeRetries: 2,
      routingRules: null,
      secretRef: null,
      updatedByUserId: null,
    });

    // 1. Merchant Owner Registration
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'owner@sharmaretail.example',
        password: 'Password123!',
        legalName: 'Sharma Retail Pvt Ltd',
        tradeName: 'Sharma Electronics',
      });

    expect(regRes.status).toBe(201);
    expect(regRes.body.success).toBe(true);
    const { merchantId } = regRes.body.data;

    // Verify merchant for testing
    await stores.merchants.updateStatus(merchantId, 'VERIFIED');

    // 2. Merchant Owner Login
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'owner@sharmaretail.example',
        password: 'Password123!',
      });

    expect(loginRes.status).toBe(200);
    const accessToken = loginRes.body.data.tokens.accessToken;
    const authHeaders = { Authorization: `Bearer ${accessToken}` };

    // 3. Create Shop
    const shopRes = await request(app)
      .post('/api/v1/merchants/shops')
      .set(authHeaders)
      .send({
        name: 'Sharma Electronics Indiranagar',
        city: 'Bengaluru',
        state: 'Karnataka',
      });

    expect(shopRes.status).toBe(201);
    const shopId = shopRes.body.data.shop.id;

    // 4. Register Customer & Record DPDP Consent
    const custRes = await request(app)
      .post('/api/v1/customers')
      .set(authHeaders)
      .send({
        fullName: 'Kavita Iyer',
        phone: '+919876543210',
        consentNoticeVersion: 'v1.0-2026',
        captureMethod: 'CUSTOMER_CHECKOUT_SESSION',
      });

    expect(custRes.status).toBe(201);
    const customerId = custRes.body.data.customer.id;

    // 5. Create Purchase Idempotently
    const purchaseRes = await request(app)
      .post('/api/v1/purchases')
      .set(authHeaders)
      .set('Idempotency-Key', 'purch-tv-4k-001')
      .send({
        shopId,
        customerId,
        productCategory: 'TELEVISION',
        productDescription: 'Sony Bravia 55 inch 4K HDR',
        amountPaise: '6500000', // Rs 65,000 (in paise)
      });

    expect(purchaseRes.status).toBe(201);
    const purchaseId = purchaseRes.body.data.purchase.id;

    // 6. Create Checkout Session & Generate QR
    const sessionRes = await request(app)
      .post('/api/v1/checkout/sessions')
      .set(authHeaders)
      .send({
        shopId,
        purchaseId,
        validityMinutes: 30,
      });

    expect(sessionRes.status).toBe(201);
    const { qrPayload, rawToken } = sessionRes.body.data;
    expect(qrPayload).toContain(rawToken);

    // 7. Customer scans QR code (public unauthenticated scan)
    const scanRes = await request(app).get(`/api/v1/checkout/sessions/${rawToken}`);
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.data.purchase.amountPaise).toBe('6500000');

    // 8. Create Financing Application
    const appRes = await request(app)
      .post('/api/v1/applications')
      .set(authHeaders)
      .send({
        shopId,
        purchaseId,
        customerId,
        requestedAmountPaise: '6500000',
        downPaymentPaise: '0',
        requestedTenureMonths: 6,
        routingMode: 'SEQUENTIAL',
      });

    expect(appRes.status).toBe(201);
    const applicationId = appRes.body.data.application.id;
    expect(appRes.body.data.application.status).toBe('CUSTOMER_CONSENT_PENDING');

    // 9. Submit Application (triggers Waterfall Orchestration Engine)
    const submitRes = await request(app)
      .post(`/api/v1/applications/${applicationId}/submit`)
      .set(authHeaders);

    expect(submitRes.status).toBe(200);
    expect(submitRes.body.data.application.status).toBe('OFFER_AVAILABLE');

    // 10. List Active Offers
    const offersRes = await request(app)
      .get(`/api/v1/applications/${applicationId}/offers`)
      .set(authHeaders);

    expect(offersRes.status).toBe(200);
    const offers = offersRes.body.data;
    expect(offers.length).toBeGreaterThan(0);
    const selectedOffer = offers[0];

    // 11. Customer Accepts Offer
    const acceptRes = await request(app)
      .post(`/api/v1/applications/${applicationId}/offers/${selectedOffer.id}/accept`)
      .set(authHeaders);

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.data.applicationStatus).toBe('CUSTOMER_ACCEPTED_OFFER');

    // 12. Asynchronous Lender Webhook: Loan Disbursed
    const webhookPayload = JSON.stringify({
      eventId: 'evt_alpha_disburse_999',
      eventType: 'LOAN_DISBURSED',
      applicationId,
      externalReference: `LENDER_ALPHA-APP-${applicationId.substring(0, 8).toUpperCase()}`,
      amountPaise: 6500000,
    });

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac('sha256', 'lender-default-dev-secret')
      .update(`${timestamp}.${webhookPayload}`)
      .digest('hex');

    const webhookRes = await request(app)
      .post('/api/v1/webhooks/lenders/LENDER_ALPHA')
      .set('X-Lender-Signature', signature)
      .set('X-Lender-Timestamp', timestamp)
      .set('Content-Type', 'application/json')
      .send(webhookPayload);

    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body.data.processed).toBe(true);

    // 13. Verify Final Application Status is DISBURSED
    const finalAppRes = await request(app)
      .get(`/api/v1/applications/${applicationId}`)
      .set(authHeaders);

    expect(finalAppRes.status).toBe(200);
    expect(finalAppRes.body.data.application.status).toBe('DISBURSED');

    // 14. Verify Commission Ledger
    const ledgerRes = await request(app)
      .get('/api/v1/ledger/commission')
      .set(authHeaders);

    expect(ledgerRes.status).toBe(200);
    // 1.5% of Rs 65,000 (6,500,000 paise) = Rs 975 = 97,500 paise
    expect(ledgerRes.body.data.summary.netCommissionPaise).toBe('97500');
    expect(ledgerRes.body.data.summary.entries.length).toBe(1);
    expect(ledgerRes.body.data.summary.entries[0].entryType).toBe('ACCRUAL');

    // 15. Verify Audit History
    const historyRes = await request(app)
      .get(`/api/v1/applications/${applicationId}/history`)
      .set(authHeaders);

    expect(historyRes.status).toBe(200);
    const statusesInHistory = historyRes.body.data.history.map((h: any) => h.toStatus);
    expect(statusesInHistory).toContain('CUSTOMER_CONSENT_PENDING');
    expect(statusesInHistory).toContain('SUBMITTED');
    expect(statusesInHistory).toContain('LENDER_PROCESSING');
    expect(statusesInHistory).toContain('OFFER_AVAILABLE');
    expect(statusesInHistory).toContain('CUSTOMER_ACCEPTED_OFFER');
    expect(statusesInHistory).toContain('DISBURSED');
  });
});

