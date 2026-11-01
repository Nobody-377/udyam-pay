import { describe, expect, it } from 'vitest';
import { EmiCalculator } from '../../src/modules/lenders/emi-calculator';

describe('EmiCalculator', () => {
  it('calculates reducing balance EMI and generates exact amortization schedule', () => {
    const principalPaise = 10000000n; // Rs 1,00,000 (100,000 * 100 paise)
    const result = EmiCalculator.calculate({
      principalPaise,
      tenureMonths: 12,
      annualInterestRatePercent: 12,
      rateType: 'REDUCING_BALANCE',
      processingFeePercent: 1.5,
    });

    expect(result.principalPaise).toBe(principalPaise);
    expect(result.tenureMonths).toBe(12);
    expect(result.emiPaise).toBeGreaterThan(0n);
    expect(result.processingFeePaise).toBe(150000n); // 1.5% of Rs 1,00,000 = Rs 1,500 = 150000 paise
    expect(result.schedule.length).toBe(12);

    // Assert that the sum of principal across all months EXACTLY matches the initial principal (zero lost paise!)
    const totalPrincipalInSchedule = result.schedule.reduce(
      (sum, item) => sum + item.principalPaise,
      0n,
    );
    expect(totalPrincipalInSchedule).toBe(principalPaise);

    // Final month remaining principal must be zero
    expect(result.schedule[11]?.remainingPrincipalPaise).toBe(0n);
  });

  it('calculates 0% interest EMI accurately', () => {
    const principalPaise = 5000000n; // Rs 50,000
    const result = EmiCalculator.calculate({
      principalPaise,
      tenureMonths: 6,
      annualInterestRatePercent: 0,
    });

    expect(result.totalInterestPaise).toBe(0n);
    expect(result.totalRepayablePaise).toBe(principalPaise);
    expect(result.schedule.length).toBe(6);

    const totalPrincipal = result.schedule.reduce((sum, item) => sum + item.principalPaise, 0n);
    expect(totalPrincipal).toBe(principalPaise);
  });

  it('calculates flat interest EMI accurately', () => {
    const principalPaise = 10000000n; // Rs 1,00,000
    const result = EmiCalculator.calculate({
      principalPaise,
      tenureMonths: 12,
      annualInterestRatePercent: 10,
      rateType: 'FLAT',
    });

    // 10% flat on Rs 1,00,000 for 1 year = Rs 10,000 interest = 1,000,000 paise
    expect(result.totalInterestPaise).toBe(1000000n);
    expect(result.totalRepayablePaise).toBe(11000000n);

    const totalPrincipal = result.schedule.reduce((sum, item) => sum + item.principalPaise, 0n);
    expect(totalPrincipal).toBe(principalPaise);
  });

  it('rejects invalid inputs', () => {
    expect(() =>
      EmiCalculator.calculate({
        principalPaise: 0n,
        tenureMonths: 12,
        annualInterestRatePercent: 10,
      }),
    ).toThrow('Principal must be positive');

    expect(() =>
      EmiCalculator.calculate({
        principalPaise: 100000n,
        tenureMonths: 0,
        annualInterestRatePercent: 10,
      }),
    ).toThrow('Tenure must be positive integer');

    expect(() =>
      EmiCalculator.calculate({
        principalPaise: 100000n,
        tenureMonths: 12,
        annualInterestRatePercent: -5,
      }),
    ).toThrow('Interest rate cannot be negative');
  });
});

