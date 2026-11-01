import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

export class FixtureValidationError extends Error {
  constructor(message: string, readonly issues?: unknown[]) {
    super(`Fixture validation error: ${message}`);
    this.name = 'FixtureValidationError';
  }
}

export const ProductCategoryEnum = z.enum([
  'SMARTPHONE',
  'TELEVISION',
  'REFRIGERATOR',
  'WASHING_MACHINE',
  'AIR_CONDITIONER',
  'LAPTOP',
  'OTHER_ELECTRONICS',
]);

export const RateTypeEnum = z.enum([
  'FIXED',
  'FLOATING',
  'FLAT',
  'REDUCING_BALANCE',
  'UNSPECIFIED',
]);

// 1. Demo Lender Schema
export const demoLenderSchema = z.object({
  code: z.string().min(2),
  displayName: z.string().min(2),
  type: z.enum(['BANK', 'NBFC', 'OTHER']),
  isSimulated: z.boolean(),
  defaultInterestRatePercent: z.number().positive(),
  minAmountPaise: z.number().int().positive(),
  maxAmountPaise: z.number().int().positive(),
  supportedCategories: z.array(ProductCategoryEnum),
  supportsDiscovery: z.boolean().default(true),
  priority: z.number().int().default(100),
  termsUrl: z.string().url().optional(),
  termsVersion: z.string().default('DEMO-v1.0'),
});

export const demoLendersListSchema = z.array(demoLenderSchema);
export type DemoLenderFixture = z.infer<typeof demoLenderSchema>;

export interface RestrictedPhoneRule {
  outcome: string;
  errorCode: string;
  reason: string;
}

export interface CategoryRule {
  maxTenureMonths: number;
  minAmountPaise: number;
}

// 2. Eligibility Rules Schema
export const eligibilityRulesSchema = z.object({
  globalMinAmountPaise: z.number().int().positive(),
  globalMaxAmountPaise: z.number().int().positive(),
  restrictedPhoneSuffixes: z.record(
    z.string(),
    z.object({
      outcome: z.string(),
      errorCode: z.string(),
      reason: z.string(),
    }),
  ),
  categoryRules: z.record(
    z.string(),
    z.object({
      maxTenureMonths: z.number().int().positive(),
      minAmountPaise: z.number().int().positive(),
    }),
  ),
});

export type EligibilityRulesFixture = z.infer<typeof eligibilityRulesSchema>;

// 3. Scenario Fixtures Schema
export const scenarioDetailSchema = z.object({
  outcome: z.enum([
    'OFFERED',
    'DECLINED',
    'ADDITIONAL_INFO_REQUIRED',
    'TIMEOUT',
    'UNAVAILABLE',
    'RATE_LIMITED',
    'MALFORMED_RESPONSE',
    'PENDING',
  ]),
  description: z.string().optional(),
  tenures: z.array(z.number().int().positive()).optional(),
  interestRatePercent: z.string().optional(),
  processingFeePercent: z.number().nonnegative().optional(),
  rateType: RateTypeEnum.optional(),
  errorCode: z.string().optional(),
  reason: z.string().optional(),
  requiredDocument: z.string().optional(),
  simulatedDelayMs: z.number().nonnegative().optional(),
  httpStatus: z.number().int().optional(),
  retryAfterSeconds: z.number().int().optional(),
  snippet: z.string().optional(),
  webhookExpected: z.boolean().optional(),
  pollIntervalSeconds: z.number().int().optional(),
});

export type ScenarioDetail = z.infer<typeof scenarioDetailSchema>;

export const scenarioFixturesSchema = z.object({
  scenarios: z.record(z.string(), scenarioDetailSchema),
  phoneSuffixMapping: z.record(z.string(), z.string()),
});

export type ScenarioFixtures = z.infer<typeof scenarioFixturesSchema>;

// Fallback embedded fixtures ensuring zero-IO availability if files are moved
const DEFAULT_LENDERS: DemoLenderFixture[] = [
  {
    code: 'DEMO_BANK_ALPHA',
    displayName: '[DEMO] Alpha Digital Bank',
    type: 'BANK',
    isSimulated: true,
    defaultInterestRatePercent: 11.5,
    minAmountPaise: 500000,
    maxAmountPaise: 50000000,
    supportedCategories: ['SMARTPHONE', 'LAPTOP', 'TELEVISION', 'AIR_CONDITIONER'],
    supportsDiscovery: true,
    priority: 10,
    termsUrl: 'https://demo.udhyam.example/terms/alpha-bank',
    termsVersion: 'DEMO-v1.0',
  },
  {
    code: 'DEMO_NBFC_BETA',
    displayName: '[DEMO] Beta Retail Finance NBFC',
    type: 'NBFC',
    isSimulated: true,
    defaultInterestRatePercent: 14.0,
    minAmountPaise: 100000,
    maxAmountPaise: 30000000,
    supportedCategories: [
      'SMARTPHONE',
      'TELEVISION',
      'REFRIGERATOR',
      'WASHING_MACHINE',
      'LAPTOP',
      'OTHER_ELECTRONICS',
    ],
    supportsDiscovery: true,
    priority: 20,
    termsUrl: 'https://demo.udhyam.example/terms/beta-finance',
    termsVersion: 'DEMO-v1.0',
  },
  {
    code: 'DEMO_GAMMA_CREDIT',
    displayName: '[DEMO] Gamma Consumer Credit',
    type: 'NBFC',
    isSimulated: true,
    defaultInterestRatePercent: 16.5,
    minAmountPaise: 50000,
    maxAmountPaise: 15000000,
    supportedCategories: ['SMARTPHONE', 'OTHER_ELECTRONICS'],
    supportsDiscovery: true,
    priority: 30,
    termsUrl: 'https://demo.udhyam.example/terms/gamma-credit',
    termsVersion: 'DEMO-v1.0',
  },
];

const DEFAULT_ELIGIBILITY: EligibilityRulesFixture = {
  globalMinAmountPaise: 50000,
  globalMaxAmountPaise: 50000000,
  restrictedPhoneSuffixes: {
    '0001': {
      outcome: 'DECLINED',
      errorCode: 'CREDIT_POLICY_DECLINE',
      reason: 'Credit score below minimum policy threshold (Simulated test scenario)',
    },
    '0008': {
      outcome: 'DECLINED',
      errorCode: 'INELIGIBLE_CRITERIA',
      reason: 'Customer does not meet age or residency eligibility criteria (Simulated test scenario)',
    },
  },
  categoryRules: {
    SMARTPHONE: { maxTenureMonths: 18, minAmountPaise: 50000 },
    LAPTOP: { maxTenureMonths: 24, minAmountPaise: 1500000 },
    TELEVISION: { maxTenureMonths: 24, minAmountPaise: 1000000 },
    REFRIGERATOR: { maxTenureMonths: 18, minAmountPaise: 1000000 },
    WASHING_MACHINE: { maxTenureMonths: 18, minAmountPaise: 800000 },
    AIR_CONDITIONER: { maxTenureMonths: 24, minAmountPaise: 1500000 },
    OTHER_ELECTRONICS: { maxTenureMonths: 12, minAmountPaise: 50000 },
  },
};

const DEFAULT_SCENARIOS: ScenarioFixtures = {
  scenarios: {
    APPROVE: {
      outcome: 'OFFERED',
      description: 'Standard multi-offer proposal across multiple tenures',
      tenures: [3, 6, 9, 12],
      processingFeePercent: 1.5,
      rateType: 'REDUCING_BALANCE',
    },
    PROMOTIONAL_ZERO_EMI: {
      outcome: 'OFFERED',
      description: 'Promotional zero-cost EMI (subvented interest)',
      tenures: [3, 6],
      interestRatePercent: '0.00',
      processingFeePercent: 0.0,
      rateType: 'FLAT',
    },
    NO_OFFERS: {
      outcome: 'DECLINED',
      errorCode: 'NO_OFFERS_MATCHED',
      reason: 'No lending partner generated a sanction proposal for this application (Simulated)',
    },
    DECLINE: {
      outcome: 'DECLINED',
      errorCode: 'CREDIT_POLICY_DECLINE',
      reason: 'Application does not meet lender risk criteria (Simulated policy decline)',
    },
    INELIGIBLE: {
      outcome: 'DECLINED',
      errorCode: 'INELIGIBLE_CRITERIA',
      reason: 'Customer profile does not meet eligibility threshold (Simulated)',
    },
    ADDITIONAL_INFO: {
      outcome: 'ADDITIONAL_INFO_REQUIRED',
      requiredDocument: 'BANK_STATEMENT_LAST_3_MONTHS',
      reason: 'Underwriting requires 3 months bank statements for credit verification',
    },
    TIMEOUT: {
      outcome: 'TIMEOUT',
      errorCode: 'LENDER_TIMEOUT',
      simulatedDelayMs: 250,
    },
    UNAVAILABLE: {
      outcome: 'UNAVAILABLE',
      errorCode: 'SERVICE_UNAVAILABLE',
      httpStatus: 503,
      reason: 'Upstream lender underwriting gateway is temporarily unavailable',
    },
    RATE_LIMITED: {
      outcome: 'RATE_LIMITED',
      errorCode: 'RATE_LIMITED',
      retryAfterSeconds: 60,
      reason: 'Upstream API rate limit reached',
    },
    MALFORMED: {
      outcome: 'MALFORMED_RESPONSE',
      errorCode: 'SCHEMA_VALIDATION_ERROR',
      snippet: '<html>502 Bad Gateway</html>',
    },
    ASYNC: {
      outcome: 'PENDING',
      webhookExpected: true,
      pollIntervalSeconds: 15,
    },
  },
  phoneSuffixMapping: {
    '0001': 'DECLINE',
    '0002': 'ADDITIONAL_INFO',
    '0003': 'TIMEOUT',
    '0004': 'UNAVAILABLE',
    '0005': 'RATE_LIMITED',
    '0006': 'MALFORMED',
    '0007': 'ASYNC',
    '0008': 'INELIGIBLE',
    '0009': 'NO_OFFERS',
    '0010': 'PROMOTIONAL_ZERO_EMI',
  },
};

export interface LoadedFixtures {
  lenders: DemoLenderFixture[];
  eligibility: EligibilityRulesFixture;
  scenarios: ScenarioFixtures;
}

function tryReadJsonFile(possiblePaths: string[]): unknown | null {
  for (const p of possiblePaths) {
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf8');
        return JSON.parse(content);
      } catch (err) {
        throw new FixtureValidationError(`Failed to parse JSON file at ${p}: ${(err as Error).message}`);
      }
    }
  }
  return null;
}

/**
 * Validates a raw fixture payload against a specific schema type.
 * Useful for validating dynamic or test fixtures.
 */
export function validateFixtureData(
  type: 'lenders' | 'eligibility' | 'scenarios',
  raw: unknown,
): unknown {
  switch (type) {
    case 'lenders': {
      const res = demoLendersListSchema.safeParse(raw);
      if (!res.success) {
        throw new FixtureValidationError('Invalid lenders fixture data', res.error.issues);
      }
      return res.data;
    }
    case 'eligibility': {
      const res = eligibilityRulesSchema.safeParse(raw);
      if (!res.success) {
        throw new FixtureValidationError('Invalid eligibility fixture data', res.error.issues);
      }
      return res.data;
    }
    case 'scenarios': {
      const res = scenarioFixturesSchema.safeParse(raw);
      if (!res.success) {
        throw new FixtureValidationError('Invalid scenario fixture data', res.error.issues);
      }
      return res.data;
    }
  }
}

/**
 * Loads and validates all mock JSON fixtures from disk, with fallback to verified defaults.
 */
export function loadAndValidateFixtures(customDir?: string): LoadedFixtures {
  const cwd = process.cwd();
  const dir = customDir ?? resolve(cwd, 'src/modules/lenders/fixtures');

  // 1. Lenders
  const lendersRaw =
    tryReadJsonFile([
      resolve(dir, 'demo-lenders.json'),
      resolve(cwd, 'dist/modules/lenders/fixtures/demo-lenders.json'),
    ]) ?? DEFAULT_LENDERS;

  const lenders = validateFixtureData('lenders', lendersRaw) as DemoLenderFixture[];

  // 2. Eligibility
  const eligibilityRaw =
    tryReadJsonFile([
      resolve(dir, 'eligibility-rules.json'),
      resolve(cwd, 'dist/modules/lenders/fixtures/eligibility-rules.json'),
    ]) ?? DEFAULT_ELIGIBILITY;

  const eligibility = validateFixtureData('eligibility', eligibilityRaw) as EligibilityRulesFixture;

  // 3. Scenarios
  const scenariosRaw =
    tryReadJsonFile([
      resolve(dir, 'scenario-fixtures.json'),
      resolve(cwd, 'dist/modules/lenders/fixtures/scenario-fixtures.json'),
    ]) ?? DEFAULT_SCENARIOS;

  const scenarios = validateFixtureData('scenarios', scenariosRaw) as ScenarioFixtures;

  return { lenders, eligibility, scenarios };
}
