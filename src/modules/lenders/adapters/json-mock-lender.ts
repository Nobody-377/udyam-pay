import { EmiCalculator } from '../emi-calculator';
import type {
  EligibilityParams,
  EligibilityResult,
  LenderAdapter,
  OfferProposal,
  SubmissionParams,
  SubmissionResult,
} from '../lender-adapter.interface';
import {
  loadAndValidateFixtures,
  type LoadedFixtures,
  type RestrictedPhoneRule,
  type CategoryRule,
} from '../fixtures/fixture-schema';

export interface JsonMockLenderConfig {
  code: string;
  displayName: string;
  defaultInterestRatePercent?: number;
  fixedScenario?: string;
  simulatedDelayMs?: number;
  isSimulated?: boolean;
  fixtures?: LoadedFixtures;
}

/**
 * JsonMockLenderAdapter implements the LenderAdapter interface using
 * validated JSON fixtures for demo lenders, eligibility rules, and scenarios.
 *
 * All decisions and offers generated are explicitly marked as simulated test data.
 */
export class JsonMockLenderAdapter implements LenderAdapter {
  readonly code: string;
  readonly displayName: string;
  readonly isSimulated: boolean;
  private readonly defaultRate: number;
  private readonly fixedScenario?: string;
  private readonly simulatedDelayMs: number;
  private readonly fixtures: LoadedFixtures;

  constructor(config: JsonMockLenderConfig) {
    this.code = config.code;
    this.displayName = config.displayName;
    this.isSimulated = config.isSimulated ?? true;
    this.defaultRate = config.defaultInterestRatePercent ?? 13.5;
    this.fixedScenario = config.fixedScenario;
    this.simulatedDelayMs = config.simulatedDelayMs ?? 10;
    this.fixtures = config.fixtures ?? loadAndValidateFixtures();
  }

  /**
   * Resolves the scenario code deterministically from:
   * 1. explicit scenarioOverride
   * 2. fixedScenario set in config
   * 3. customer phone suffix matched against scenario-fixtures.json
   * 4. default: 'APPROVE'
   */
  resolveScenario(params: SubmissionParams): string {
    if (params.scenarioOverride) return params.scenarioOverride;
    if (this.fixedScenario) return this.fixedScenario;

    const phone = params.customer.phone;
    const mapping = this.fixtures.scenarios.phoneSuffixMapping as Record<string, string>;
    for (const suffix of Object.keys(mapping)) {
      if (phone.endsWith(suffix)) {
        const matched = mapping[suffix];
        if (matched) return matched;
      }
    }

    return 'APPROVE';
  }

  async checkEligibility(params: EligibilityParams): Promise<EligibilityResult> {
    const { eligibility } = this.fixtures;

    // Check restricted phone suffixes in eligibility rules
    const restricted = eligibility.restrictedPhoneSuffixes as Record<string, RestrictedPhoneRule>;
    for (const suffix of Object.keys(restricted)) {
      if (params.customer.phone.endsWith(suffix)) {
        const rule = restricted[suffix];
        return {
          eligible: false,
          reason: rule?.reason ?? 'Simulated eligibility restriction',
        };
      }
    }

    // Check global maximum
    const globalMax = BigInt(eligibility.globalMaxAmountPaise);
    if (params.amountPaise > globalMax) {
      return {
        eligible: false,
        maxAmountPaise: globalMax,
        reason: 'Exceeds maximum allowable financing limit for platform',
      };
    }

    // Check category rules
    const catRules = eligibility.categoryRules as Record<string, CategoryRule>;
    const catRule = catRules[params.productCategory];
    if (catRule) {
      const catMin = BigInt(catRule.minAmountPaise);
      if (params.amountPaise < catMin) {
        return {
          eligible: false,
          minAmountPaise: catMin,
          reason: `Requested amount is below minimum threshold for ${params.productCategory}`,
        };
      }
    }

    const minAmount = BigInt(eligibility.globalMinAmountPaise);
    return {
      eligible: true,
      maxAmountPaise: globalMax,
      minAmountPaise: minAmount,
    };
  }

  async submitApplication(params: SubmissionParams): Promise<SubmissionResult> {
    const startTime = Date.now();
    const scenarioKey = this.resolveScenario(params);
    const scenario = this.fixtures.scenarios.scenarios[scenarioKey];

    if (this.simulatedDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.simulatedDelayMs));
    }

    const extRef = `${this.code}-APP-${params.applicationId.substring(0, 8).toUpperCase()}`;

    // Handle unknown scenario key safely
    if (!scenario) {
      return {
        outcome: 'DECLINED',
        externalReference: extRef,
        errorCode: 'UNKNOWN_TEST_SCENARIO',
        safeResponseSummary: { error: `Unrecognized test scenario: ${scenarioKey}` },
        latencyMs: Date.now() - startTime,
      };
    }

    switch (scenario.outcome) {
      case 'DECLINED':
        return {
          outcome: 'DECLINED',
          externalReference: extRef,
          errorCode: scenario.errorCode ?? 'CREDIT_POLICY_DECLINE',
          safeResponseSummary: {
            reason: scenario.reason ?? 'Application does not meet lender risk criteria (Simulated)',
            isSimulated: true,
          },
          latencyMs: Date.now() - startTime,
        };

      case 'ADDITIONAL_INFO_REQUIRED':
        return {
          outcome: 'ADDITIONAL_INFO_REQUIRED',
          externalReference: extRef,
          safeResponseSummary: {
            requiredDocument: scenario.requiredDocument ?? 'BANK_STATEMENT_LAST_3_MONTHS',
            reason: scenario.reason,
            isSimulated: true,
          },
          latencyMs: Date.now() - startTime,
        };

      case 'TIMEOUT':
        if (scenario.simulatedDelayMs && scenario.simulatedDelayMs > 0) {
          await new Promise((r) => setTimeout(r, scenario.simulatedDelayMs));
        }
        return {
          outcome: 'TIMEOUT',
          errorCode: scenario.errorCode ?? 'LENDER_TIMEOUT',
          safeResponseSummary: { simulatedTimeout: true },
          latencyMs: Date.now() - startTime,
        };

      case 'UNAVAILABLE':
        return {
          outcome: 'UNAVAILABLE',
          errorCode: scenario.errorCode ?? 'SERVICE_UNAVAILABLE',
          safeResponseSummary: {
            httpStatus: scenario.httpStatus ?? 503,
            reason: scenario.reason ?? 'Service temporarily unavailable',
            isSimulated: true,
          },
          latencyMs: Date.now() - startTime,
        };

      case 'RATE_LIMITED':
        return {
          outcome: 'RATE_LIMITED',
          errorCode: scenario.errorCode ?? 'RATE_LIMITED',
          safeResponseSummary: {
            retryAfterSeconds: scenario.retryAfterSeconds ?? 60,
            isSimulated: true,
          },
          latencyMs: Date.now() - startTime,
        };

      case 'MALFORMED_RESPONSE':
        return {
          outcome: 'MALFORMED_RESPONSE',
          errorCode: scenario.errorCode ?? 'SCHEMA_VALIDATION_ERROR',
          safeResponseSummary: {
            rawSnippet: scenario.snippet ?? '<html>502 Bad Gateway</html>',
            isSimulated: true,
          },
          latencyMs: Date.now() - startTime,
        };

      case 'PENDING':
        return {
          outcome: 'PENDING',
          externalReference: extRef,
          safeResponseSummary: {
            webhookExpected: scenario.webhookExpected ?? true,
            pollUrl: `/lenders/${this.code}/status/${extRef}`,
            isSimulated: true,
          },
          latencyMs: Date.now() - startTime,
        };

      case 'OFFERED':
      default: {
        const tenures: number[] = params.requestedTenureMonths
          ? [params.requestedTenureMonths]
          : (scenario.tenures ?? [3, 6, 9, 12]);

        const feePercent = scenario.processingFeePercent ?? 1.5;
        const ratePercent =
          scenario.interestRatePercent !== undefined
            ? parseFloat(scenario.interestRatePercent)
            : this.defaultRate;
        const rateType = scenario.rateType ?? 'REDUCING_BALANCE';

        const offers: OfferProposal[] = tenures.map((tenure: number) => {
          const emiResult = EmiCalculator.calculate({
            principalPaise: params.requestedAmountPaise,
            tenureMonths: tenure,
            annualInterestRatePercent: ratePercent,
            rateType,
            processingFeePercent: feePercent,
          });

          return {
            lenderOfferReference: `${extRef}-OFR-${tenure}M`,
            principalPaise: params.requestedAmountPaise,
            tenureMonths: tenure,
            interestRatePercent: ratePercent.toFixed(2),
            rateType,
            aprPercent: (ratePercent + feePercent).toFixed(2),
            emiPaise: emiResult.emiPaise,
            processingFeePaise: emiResult.processingFeePaise,
            totalRepayablePaise: emiResult.totalRepayablePaise,
            termsVersion: 'DEMO-v1.0',
            termsUrl: `https://demo.udhyam.example/terms/${this.code.toLowerCase()}`,
          };
        });

        return {
          outcome: 'OFFERED',
          externalReference: extRef,
          offers,
          safeResponseSummary: {
            offerCount: offers.length,
            sanctionedAmountPaise: params.requestedAmountPaise.toString(),
            isSimulated: true,
            demoLender: this.displayName,
          },
          latencyMs: Date.now() - startTime,
        };
      }
    }
  }

  async cancelApplication(_externalReference: string): Promise<boolean> {
    return true;
  }
}
