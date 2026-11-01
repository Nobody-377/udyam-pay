import type { RateType } from '../persistence/stores';

export interface RepaymentInstallment {
  month: number;
  emiPaise: bigint;
  principalPaise: bigint;
  interestPaise: bigint;
  remainingPrincipalPaise: bigint;
}

export interface EmiCalculationResult {
  principalPaise: bigint;
  tenureMonths: number;
  annualInterestRatePercent: number;
  rateType: RateType;
  emiPaise: bigint;
  totalInterestPaise: bigint;
  totalRepayablePaise: bigint;
  processingFeePaise: bigint;
  schedule: RepaymentInstallment[];
}

export interface EmiCalculationParams {
  principalPaise: bigint;
  tenureMonths: number;
  annualInterestRatePercent: number;
  rateType?: RateType;
  processingFeePercent?: number;
  flatProcessingFeePaise?: bigint;
}

export class EmiCalculator {
  /**
   * Calculates monthly EMI and full repayment amortization schedule.
   * Uses integer paise math throughout. Rounding residue is applied to the final installment
   * so that the sum of principal installments exactly equals the initial principal amount.
   */
  static calculate(params: EmiCalculationParams): EmiCalculationResult {
    const {
      principalPaise,
      tenureMonths,
      annualInterestRatePercent,
      rateType = 'REDUCING_BALANCE',
      processingFeePercent = 0,
      flatProcessingFeePaise = 0n,
    } = params;

    if (principalPaise <= 0n) throw new Error('Principal must be positive');
    if (tenureMonths <= 0 || !Number.isInteger(tenureMonths)) throw new Error('Tenure must be positive integer');
    if (annualInterestRatePercent < 0) throw new Error('Interest rate cannot be negative');

    // Processing fee calculation
    let processingFeePaise = flatProcessingFeePaise;
    if (processingFeePercent > 0) {
      // (principalPaise * processingFeePercent * 100) / 10000
      const percentBasis = BigInt(Math.round(processingFeePercent * 100));
      processingFeePaise += (principalPaise * percentBasis) / 10000n;
    }

    if (annualInterestRatePercent === 0) {
      // 0% interest (e.g. No Cost EMI)
      const baseEmi = principalPaise / BigInt(tenureMonths);
      const remainder = principalPaise % BigInt(tenureMonths);
      const schedule: RepaymentInstallment[] = [];
      let remaining = principalPaise;

      for (let m = 1; m <= tenureMonths; m++) {
        // Last month absorbs remainder
        const currentPrincipal = m === tenureMonths ? baseEmi + remainder : baseEmi;
        remaining -= currentPrincipal;
        schedule.push({
          month: m,
          emiPaise: currentPrincipal,
          principalPaise: currentPrincipal,
          interestPaise: 0n,
          remainingPrincipalPaise: remaining,
        });
      }

      return {
        principalPaise,
        tenureMonths,
        annualInterestRatePercent: 0,
        rateType,
        emiPaise: baseEmi,
        totalInterestPaise: 0n,
        totalRepayablePaise: principalPaise,
        processingFeePaise,
        schedule,
      };
    }

    if (rateType === 'FLAT') {
      // Total Interest = P * (R / 100) * (T / 12)
      // in integer paise
      const rateBasis = BigInt(Math.round(annualInterestRatePercent * 100));
      const totalInterestPaise =
        (principalPaise * rateBasis * BigInt(tenureMonths)) / (10000n * 12n);
      const totalRepayablePaise = principalPaise + totalInterestPaise;
      const baseEmi = totalRepayablePaise / BigInt(tenureMonths);
      const emiRemainder = totalRepayablePaise % BigInt(tenureMonths);

      const basePrincipal = principalPaise / BigInt(tenureMonths);
      const principalRemainder = principalPaise % BigInt(tenureMonths);
      const baseInterest = totalInterestPaise / BigInt(tenureMonths);
      const interestRemainder = totalInterestPaise % BigInt(tenureMonths);

      const schedule: RepaymentInstallment[] = [];
      let remaining = principalPaise;

      for (let m = 1; m <= tenureMonths; m++) {
        const isLast = m === tenureMonths;
        const p = isLast ? basePrincipal + principalRemainder : basePrincipal;
        const i = isLast ? baseInterest + interestRemainder : baseInterest;
        const emi = isLast ? baseEmi + emiRemainder : baseEmi;
        remaining -= p;
        schedule.push({
          month: m,
          emiPaise: emi,
          principalPaise: p,
          interestPaise: i,
          remainingPrincipalPaise: remaining,
        });
      }

      return {
        principalPaise,
        tenureMonths,
        annualInterestRatePercent,
        rateType: 'FLAT',
        emiPaise: baseEmi,
        totalInterestPaise,
        totalRepayablePaise,
        processingFeePaise,
        schedule,
      };
    }

    // Default: REDUCING_BALANCE
    // E = P * r * (1 + r)^n / ((1 + r)^n - 1)
    const monthlyRate = annualInterestRatePercent / (12 * 100);
    const compound = Math.pow(1 + monthlyRate, tenureMonths);
    const emiFactor = (monthlyRate * compound) / (compound - 1);
    const calculatedEmi = BigInt(Math.round(Number(principalPaise) * emiFactor));

    const schedule: RepaymentInstallment[] = [];
    let remaining = principalPaise;
    let totalInterest = 0n;

    for (let m = 1; m <= tenureMonths; m++) {
      if (m === tenureMonths) {
        // Last month: remaining principal is cleared
        const interest = BigInt(Math.round(Number(remaining) * monthlyRate));
        const principal = remaining;
        const finalEmi = principal + interest;
        totalInterest += interest;
        remaining = 0n;
        schedule.push({
          month: m,
          emiPaise: finalEmi,
          principalPaise: principal,
          interestPaise: interest,
          remainingPrincipalPaise: 0n,
        });
      } else {
        const interest = BigInt(Math.round(Number(remaining) * monthlyRate));
        const principal = calculatedEmi > interest ? calculatedEmi - interest : 0n;
        remaining -= principal;
        totalInterest += interest;
        schedule.push({
          month: m,
          emiPaise: calculatedEmi,
          principalPaise: principal,
          interestPaise: interest,
          remainingPrincipalPaise: remaining,
        });
      }
    }

    return {
      principalPaise,
      tenureMonths,
      annualInterestRatePercent,
      rateType: 'REDUCING_BALANCE',
      emiPaise: calculatedEmi,
      totalInterestPaise: totalInterest,
      totalRepayablePaise: principalPaise + totalInterest,
      processingFeePaise,
      schedule,
    };
  }
}

