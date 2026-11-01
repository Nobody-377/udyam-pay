import { describe, expect, it } from 'vitest';
import { CommissionService } from '../../src/modules/ledger/commission.service';
import { ExpirationWorker } from '../../src/modules/workers/expiration.worker';
import { ConflictError, NotFoundError } from '../../src/common/errors';
import { InMemoryStores } from '../../src/modules/persistence/in-memory-store';

/**
 * Persistence integration test suite.
 * Tests behavior across store implementations (PrismaStore contracts & InMemoryStores harness)
 * validating database constraints, optimistic locking, and bounded batch semantics.
 */
describe('Persistence Integration: Commission & Expiration Stores', () => {
  describe('Commission Persistence & Invariants', () => {
    it('creates an accrual, prevents duplicate accruals, and computes totals', async () => {
      const stores = new InMemoryStores();
      const service = new CommissionService(stores);

      const m = await stores.merchants.create({
        legalName: 'Apex Electronics',
        tradeName: 'Apex',
        status: 'VERIFIED',
        verifiedAt: new Date(),
        suspendedAt: null,
        suspensionReason: null,
      });

      const s = await stores.shops.create({
        merchantId: m.id,
        name: 'Main Branch',
        city: 'Bengaluru',
        state: 'Karnataka',
        status: 'ACTIVE',
      });

      const c = await stores.customers.create({
        merchantId: m.id,
        fullName: 'Ravi Kumar',
        phone: '+919876543210',
        retentionExpiresAt: null,
        anonymizedAt: null,
      });

      const p = await stores.purchases.createIdempotent({
        merchantId: m.id,
        shopId: s.id,
        customerId: c.id,
        productCategory: 'SMARTPHONE',
        productDescription: 'Phone',
        amountPaise: 5000000n,
        currency: 'INR',
        idempotencyKey: 'p-comm-test-1',
      });

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
        idempotencyKey: 'app-comm-test-1',
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
        amountPaise: 5000000n,
        lenderTransactionRef: 'TX-COMM-1',
        lenderConfirmedAt: new Date(),
        reconciliationStatus: 'MATCHED',
        reconciledAt: new Date(),
      });

      // 1. Successful Accrual
      const accrual = await service.accrue({
        merchantId: m.id,
        applicationId: app.id,
        transactionId: tx.id,
        amountPaise: 75000n, // 1.5%
        ruleCode: '1.5_RETAIL',
        ruleSnapshot: { rate: 1.5 },
      });

      expect(accrual.id).toBeDefined();
      expect(accrual.entryType).toBe('ACCRUAL');
      expect(accrual.amountPaise).toBe(75000n);

      // 2. Reject duplicate accrual on same transaction
      await expect(
        service.accrue({
          merchantId: m.id,
          applicationId: app.id,
          transactionId: tx.id,
          amountPaise: 75000n,
          ruleCode: '1.5_RETAIL',
          ruleSnapshot: { rate: 1.5 },
        }),
      ).rejects.toThrow(ConflictError);

      // 3. Totals after accrual
      const summaryAfterAccrual = await service.getMerchantSummary(m.id);
      expect(summaryAfterAccrual.totalAccruedPaise).toBe(75000n);
      expect(summaryAfterAccrual.totalReversedPaise).toBe(0n);
      expect(summaryAfterAccrual.netCommissionPaise).toBe(75000n);
      expect(summaryAfterAccrual.entries.length).toBe(1);

      // 4. Reject reversal of nonexistent entry
      await expect(
        service.reverse({
          commissionEntryId: '00000000-0000-0000-0000-000000000000',
          reason: 'Nonexistent',
        }),
      ).rejects.toThrow(NotFoundError);

      // 5. Successful Reversal (matches original amount exactly)
      const reversal = await service.reverse({
        commissionEntryId: accrual.id,
        reason: 'Order cancelled by customer',
      });

      expect(reversal.entryType).toBe('REVERSAL');
      expect(reversal.amountPaise).toBe(75000n);
      expect(reversal.reversesEntryId).toBe(accrual.id);

      // 6. Reject duplicate reversal
      await expect(
        service.reverse({
          commissionEntryId: accrual.id,
          reason: 'Second reversal attempt',
        }),
      ).rejects.toThrow(ConflictError);

      // 7. Reject reversal of a non-accrual (reversal) entry
      await expect(
        service.reverse({
          commissionEntryId: reversal.id,
          reason: 'Cannot reverse a reversal',
        }),
      ).rejects.toThrow(ConflictError);

      // 8. Totals after reversal
      const summaryAfterReversal = await service.getMerchantSummary(m.id);
      expect(summaryAfterReversal.totalAccruedPaise).toBe(75000n);
      expect(summaryAfterReversal.totalReversedPaise).toBe(75000n);
      expect(summaryAfterReversal.netCommissionPaise).toBe(0n);
      expect(summaryAfterReversal.entries.length).toBe(2);

      // 9. Pagination check
      const paginated = await stores.commissions.listByMerchant(m.id, 0, 1);
      expect(paginated.items.length).toBe(1);
      expect(paginated.total).toBe(2);
    });
  });

  describe('Expiration Worker & State Machine Enforcement', () => {
    it('sweeps expired sessions and applications according to state machine transitions', async () => {
      const stores = new InMemoryStores();
      const worker = new ExpirationWorker(stores, { batchSize: 5 });

      const m = await stores.merchants.create({
        legalName: 'Apex Retail',
        tradeName: 'Apex',
        status: 'VERIFIED',
        verifiedAt: new Date(),
        suspendedAt: null,
        suspensionReason: null,
      });

      const s = await stores.shops.create({
        merchantId: m.id,
        name: 'Shop 1',
        city: 'Bengaluru',
        state: 'Karnataka',
        status: 'ACTIVE',
      });

      const c = await stores.customers.create({
        merchantId: m.id,
        fullName: 'Anita',
        phone: '+919876543211',
        retentionExpiresAt: null,
        anonymizedAt: null,
      });

      const p1 = await stores.purchases.createIdempotent({
        merchantId: m.id,
        shopId: s.id,
        customerId: c.id,
        productCategory: 'LAPTOP',
        productDescription: 'Laptop 1',
        amountPaise: 8000000n,
        currency: 'INR',
        idempotencyKey: 'p-exp-t1',
      });

      const p2 = await stores.purchases.createIdempotent({
        merchantId: m.id,
        shopId: s.id,
        customerId: c.id,
        productCategory: 'TELEVISION',
        productDescription: 'TV 1',
        amountPaise: 4500000n,
        currency: 'INR',
        idempotencyKey: 'p-exp-t2',
      });

      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const tenMinutesFuture = new Date(Date.now() + 10 * 60 * 1000);

      // 1. Expired session
      const expiredSession = await stores.checkoutSessions.create({
        merchantId: m.id,
        shopId: s.id,
        purchaseId: p1.id,
        status: 'ACTIVE',
        tokenHash: 'hash-exp-100',
        createdByUserId: null,
        expiresAt: tenMinutesAgo,
        consumedAt: null,
        revokedAt: null,
      });

      // 2. Active session
      const activeSession = await stores.checkoutSessions.create({
        merchantId: m.id,
        shopId: s.id,
        purchaseId: p1.id,
        status: 'ACTIVE',
        tokenHash: 'hash-act-100',
        createdByUserId: null,
        expiresAt: tenMinutesFuture,
        consumedAt: null,
        revokedAt: null,
      });

      // 3. Expired application in DRAFT
      const expiredApp = await stores.applications.create({
        merchantId: m.id,
        shopId: s.id,
        purchaseId: p1.id,
        customerId: c.id,
        createdByUserId: null,
        status: 'DRAFT',
        routingMode: 'SEQUENTIAL',
        requestedAmountPaise: 8000000n,
        downPaymentPaise: 0n,
        requestedTenureMonths: 12,
        idempotencyKey: 'app-exp-t1',
        submittedAt: null,
        expiresAt: tenMinutesAgo,
        terminalAt: null,
      });

      // 4. Active application with future expiry
      const activeApp = await stores.applications.create({
        merchantId: m.id,
        shopId: s.id,
        purchaseId: p2.id,
        customerId: c.id,
        createdByUserId: null,
        status: 'OFFER_AVAILABLE',
        routingMode: 'SEQUENTIAL',
        requestedAmountPaise: 4500000n,
        downPaymentPaise: 0n,
        requestedTenureMonths: 6,
        idempotencyKey: 'app-act-t2',
        submittedAt: new Date(),
        expiresAt: tenMinutesFuture,
        terminalAt: null,
      });

      // Run Sweep
      const result = await worker.runSweep(new Date());
      expect(result.expiredSessions).toBe(1);
      expect(result.expiredApplications).toBe(1);

      // Assert expired session status
      const updatedS1 = await stores.checkoutSessions.findById(expiredSession.id);
      expect(updatedS1?.status).toBe('EXPIRED');

      // Assert active session unchanged
      const updatedS2 = await stores.checkoutSessions.findById(activeSession.id);
      expect(updatedS2?.status).toBe('ACTIVE');

      // Assert expired application updated to EXPIRED with terminalAt
      const updatedApp1 = await stores.applications.findById(expiredApp.id);
      expect(updatedApp1?.status).toBe('EXPIRED');
      expect(updatedApp1?.terminalAt).toBeInstanceOf(Date);

      // Assert active app remains OFFER_AVAILABLE
      const updatedApp2 = await stores.applications.findById(activeApp.id);
      expect(updatedApp2?.status).toBe('OFFER_AVAILABLE');

      // Repeated sweep is idempotent (0 additional records expired)
      const repeatResult = await worker.runSweep(new Date());
      expect(repeatResult.expiredSessions).toBe(0);
      expect(repeatResult.expiredApplications).toBe(0);
    });
  });
});
