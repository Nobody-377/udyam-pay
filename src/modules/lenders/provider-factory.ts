import { IntegrationConfigurationError } from '../../common/errors';
import type { AppConfig } from '../../config/env';
import type {
  EligibilityParams,
  EligibilityResult,
  LenderAdapter,
  SubmissionParams,
  SubmissionResult,
} from './lender-adapter.interface';
import { JsonMockLenderAdapter } from './adapters/json-mock-lender';
import { loadAndValidateFixtures, type LoadedFixtures } from './fixtures/fixture-schema';

export interface ProviderFactoryOptions {
  fixtures?: LoadedFixtures;
  failFastOnMissingCredentials?: boolean;
}

/**
 * ProductionDisabledLenderAdapter implements LenderAdapter for production environments
 * where real aggregator credentials have not yet been provided.
 *
 * It safely fails closed and NEVER returns simulated offers.
 */
export class ProductionDisabledLenderAdapter implements LenderAdapter {
  readonly code: string;
  readonly displayName: string;

  constructor(code: string, displayName: string) {
    this.code = code;
    this.displayName = displayName;
  }

  async checkEligibility(_params: EligibilityParams): Promise<EligibilityResult> {
    return {
      eligible: false,
      reason: 'Lending aggregator is not configured in production mode. Service unavailable.',
    };
  }

  async submitApplication(_params: SubmissionParams): Promise<SubmissionResult> {
    return {
      outcome: 'UNAVAILABLE',
      errorCode: 'AGGREGATOR_NOT_CONFIGURED',
      safeResponseSummary: {
        error:
          'Production lending aggregator credentials are not configured. Mock fallback is strictly forbidden.',
        isSimulated: false,
      },
    };
  }

  async cancelApplication(_externalReference: string): Promise<boolean> {
    return false;
  }
}

/**
 * Creates and initializes lender adapters based on config.PROVIDER_MODE.
 *
 * - 'mock': Registers JSON-fixture backed demo lenders (and legacy test aliases).
 * - 'sandbox': Validates sandbox credentials; registers sandbox client when available.
 * - 'production': Never uses mock adapters. Validates production credentials. If credentials
 *   are missing and failFast is set, throws IntegrationConfigurationError; otherwise registers
 *   a safe fail-closed adapter that rejects submissions without generating fake offers.
 */
export function createLenderAdapters(
  config: AppConfig,
  options: ProviderFactoryOptions = {},
): Map<string, LenderAdapter> {
  const adapters = new Map<string, LenderAdapter>();
  const mode = config.PROVIDER_MODE;

  if (mode === 'mock') {
    const fixtures = options.fixtures ?? loadAndValidateFixtures();

    // 1. Register demo lenders from validated JSON fixtures
    for (const demoLender of fixtures.lenders) {
      adapters.set(
        demoLender.code,
        new JsonMockLenderAdapter({
          code: demoLender.code,
          displayName: demoLender.displayName,
          defaultInterestRatePercent: demoLender.defaultInterestRatePercent,
          fixtures,
        }),
      );
    }

    // 2. Register legacy aliases for backward compatibility with existing tests
    if (!adapters.has('LENDER_ALPHA')) {
      adapters.set(
        'LENDER_ALPHA',
        new JsonMockLenderAdapter({
          code: 'LENDER_ALPHA',
          displayName: 'Alpha Digital Bank',
          defaultInterestRatePercent: 12.5,
          fixtures,
        }),
      );
    }
    if (!adapters.has('LENDER_BETA')) {
      adapters.set(
        'LENDER_BETA',
        new JsonMockLenderAdapter({
          code: 'LENDER_BETA',
          displayName: 'Beta Retail Finance NBFC',
          defaultInterestRatePercent: 14.5,
          fixtures,
        }),
      );
    }

    return adapters;
  }

  if (mode === 'production' || mode === 'sandbox') {
    const hasCredentials =
      Boolean(config.AGGREGATOR_BASE_URL) &&
      Boolean(config.AGGREGATOR_API_KEY) &&
      Boolean(config.AGGREGATOR_CLIENT_SECRET);

    if (!hasCredentials) {
      if (options.failFastOnMissingCredentials || mode === 'sandbox') {
        throw new IntegrationConfigurationError(
          `Missing ${mode} aggregator credentials (AGGREGATOR_BASE_URL, AGGREGATOR_API_KEY). Mock fallback is strictly forbidden in ${mode} mode.`,
        );
      }

      // Safe fail-closed disabled adapters
      adapters.set(
        'AGGREGATOR_DEFAULT',
        new ProductionDisabledLenderAdapter(
          'AGGREGATOR_DEFAULT',
          'Production Lending Aggregator (Unconfigured)',
        ),
      );
      return adapters;
    }

    // When real aggregator credentials are provided in future, initialize genuine adapter
    // For now, fail safely if invoked:
    adapters.set(
      'AGGREGATOR_DEFAULT',
      new ProductionDisabledLenderAdapter(
        'AGGREGATOR_DEFAULT',
        'Production Lending Aggregator (Pending Live Provisioning)',
      ),
    );
    return adapters;
  }

  throw new IntegrationConfigurationError(`Unknown PROVIDER_MODE: ${mode}`);
}

