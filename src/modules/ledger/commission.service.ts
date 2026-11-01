import { ConflictError, NotFoundError } from '../../common/errors';
import type {
  AppStores,
  CommissionEntryEntity,
} from '../persistence/stores';

export interface AccrueCommissionParams {
  merchantId: string;
  applicationId: string;
  transactionId: string;
  amountPaise: bigint;
  ruleCode: string;
  ruleSnapshot: Record<string, unknown>;
  note?: string;
}

export interface ReverseCommissionParams {
  commissionEntryId: string;
  reason: string;
  note?: string;
}

export interface CommissionSummary {
  entries: CommissionEntryEntity[];
  totalAccruedPaise: bigint;
  totalReversedPaise: bigint;
  netCommissionPaise: bigint;
}

export class CommissionService {
  constructor(private readonly stores: AppStores) {}

  async accrue(params: AccrueCommissionParams): Promise<CommissionEntryEntity> {
    const { merchantId, applicationId, transactionId, amountPaise, ruleCode, ruleSnapshot, note } =
      params;

    if (amountPaise <= 0n) {
      throw new ConflictError('Commission amount must be positive integer paise');
    }

    const transaction = await this.stores.transactions.findById(transactionId);
    if (!transaction) throw new NotFoundError('Transaction not found');
    if (transaction.status !== 'CONFIRMED') {
      throw new ConflictError('Cannot accrue commission on unconfirmed transaction');
    }

    // Enforce unique accrual per transaction
    const existing = await this.stores.commissions.findByTransaction(transactionId);
    const hasAccrual = existing.some((e) => e.entryType === 'ACCRUAL');
    if (hasAccrual) {
      throw new ConflictError(
        `Commission already accrued for transaction ${transactionId}. Multiple accruals forbidden.`,
      );
    }

    return this.stores.commissions.accrue({
      merchantId,
      applicationId,
      transactionId,
      entryType: 'ACCRUAL',
      amountPaise,
      ruleCode,
      ruleSnapshot,
      reversesEntryId: null,
      note: note ?? 'Commission accrued on confirmed loan disbursement',
    });
  }

  async reverse(params: ReverseCommissionParams): Promise<CommissionEntryEntity> {
    const { commissionEntryId, reason, note } = params;

    // Find original entry via proper store interface
    const original = await this.stores.commissions.findById(commissionEntryId);

    if (!original) {
      throw new NotFoundError(`Commission entry ${commissionEntryId} not found`);
    }

    if (original.entryType !== 'ACCRUAL') {
      throw new ConflictError('Only ACCRUAL entries can be reversed');
    }

    // Check if already reversed via proper store interface
    const existingReversal = await this.stores.commissions.findReversal(commissionEntryId);
    if (existingReversal) {
      throw new ConflictError(`Commission entry ${commissionEntryId} has already been reversed`);
    }

    return this.stores.commissions.reverse({
      merchantId: original.merchantId,
      applicationId: original.applicationId,
      transactionId: original.transactionId,
      entryType: 'REVERSAL',
      amountPaise: original.amountPaise, // Exactly reverses original amount
      ruleCode: original.ruleCode,
      ruleSnapshot: {
        originalEntryId: original.id,
        reversalReason: reason,
        reversedAt: new Date().toISOString(),
      },
      reversesEntryId: original.id,
      note: note ?? `Reversal: ${reason}`,
    });
  }

  async getMerchantSummary(
    merchantId: string,
    skip?: number,
    take?: number,
  ): Promise<CommissionSummary> {
    const [list, totals] = await Promise.all([
      this.stores.commissions.listByMerchant(merchantId, skip, take),
      this.stores.commissions.getMerchantTotals(merchantId),
    ]);

    return {
      entries: list.items,
      totalAccruedPaise: totals.totalAccruedPaise,
      totalReversedPaise: totals.totalReversedPaise,
      netCommissionPaise: totals.netCommissionPaise,
    };
  }
}

