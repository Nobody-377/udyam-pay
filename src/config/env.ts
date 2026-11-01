import { URL } from 'node:url';
import { z } from 'zod';

export interface EnvIssue {
  path: string;
  message: string;
}

/**
 * Thrown when environment variables are missing or invalid.
 * The message lists variable names and problems only, never the offending
 * values, because values such as DATABASE_URL contain credentials.
 */
export class EnvValidationError extends Error {
  readonly issues: readonly EnvIssue[];

  constructor(issues: readonly EnvIssue[]) {
    super(
      `Invalid environment configuration:\n${issues
        .map((issue) => `  - ${issue.path}: ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

const booleanFromString = z.enum(['true', 'false']).transform((value: string) => value === 'true');

const originsSchema = z
  .string()
  .default('')
  .transform((raw: string, ctx: any) => {
    const origins = raw
      .split(',')
      .map((entry: string) => entry.trim())
      .filter((entry: string) => entry.length > 0);

    for (const origin of origins) {
      let valid = false;
      try {
        const url = new URL(origin);
        valid = (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === origin;
      } catch {
        valid = false;
      }
      if (!valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'must be a comma-separated list of exact origins such as https://app.example.com (no wildcard, path or trailing slash)',
        });
        return z.NEVER;
      }
    }
    return origins;
  });

const postgresUrlSchema = z
  .string()
  .min(1)
  .refine(
    (value: string) => {
      try {
        const url = new URL(value);
        return url.protocol === 'postgresql:' || url.protocol === 'postgres:';
      } catch {
        return false;
      }
    },
    { message: 'must be a valid postgresql:// connection URL' },
  );

export const DEV_DEFAULT_JWT_SECRET = 'udyam-pay-dev-super-secret-jwt-key-min-32-chars!';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: booleanFromString.default('false'),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    CORS_ALLOWED_ORIGINS: originsSchema,
    REQUEST_BODY_LIMIT: z
      .string()
      .regex(/^\d+(b|kb|mb)$/i, 'must look like 100kb, 1mb or 512b')
      .default('100kb'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    DATABASE_URL: postgresUrlSchema,
    JWT_SECRET: z
      .string()
      .min(32, 'must be at least 32 characters')
      .optional(),
    JWT_ACCESS_EXPIRY: z.string().default('15m'),
    JWT_REFRESH_EXPIRY_DAYS: z.coerce.number().int().positive().default(30),
    WEBHOOK_DEFAULT_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
    DEV_DEFAULT_WEBHOOK_SECRET: z.string().optional(),
    PROVIDER_MODE: z.enum(['mock', 'sandbox', 'production']).optional(),
    AGGREGATOR_BASE_URL: z.string().url().optional(),
    AGGREGATOR_API_KEY: z.string().min(16).optional(),
    AGGREGATOR_CLIENT_SECRET: z.string().min(16).optional(),
    AGGREGATOR_WEBHOOK_SECRET: z.string().min(16).optional(),
  })
  .superRefine((config: any, ctx: any) => {
    if (config.NODE_ENV === 'production') {
      if (config.PROVIDER_MODE === 'mock') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PROVIDER_MODE'],
          message:
            'PROVIDER_MODE must not be "mock" in production. Production mode must never silently fall back to mock offers.',
        });
      }

      if (!config.JWT_SECRET || config.JWT_SECRET.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: 'JWT_SECRET is required in production and must be explicitly configured',
        });
      } else if (config.JWT_SECRET === DEV_DEFAULT_JWT_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: 'JWT_SECRET must not use the default development secret in production',
        });
      }

      if (config.DEV_DEFAULT_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DEV_DEFAULT_WEBHOOK_SECRET'],
          message: 'DEV_DEFAULT_WEBHOOK_SECRET must not be configured in production',
        });
      }
      if (config.LOG_PRETTY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['LOG_PRETTY'],
          message: 'must be false in production (structured JSON logs are required)',
        });
      }
    }
  })
  .transform((config: any) => {
    const resolvedProviderMode =
      config.PROVIDER_MODE ?? (config.NODE_ENV === 'production' ? 'production' : 'mock');

    return {
      ...config,
      JWT_SECRET: config.JWT_SECRET ?? DEV_DEFAULT_JWT_SECRET,
      PROVIDER_MODE: resolvedProviderMode,
    } as Omit<typeof config, 'JWT_SECRET' | 'PROVIDER_MODE'> & {
      JWT_SECRET: string;
      PROVIDER_MODE: 'mock' | 'sandbox' | 'production';
    };
  });

export type AppConfig = z.infer<typeof envSchema>;

/** Parse and validate a set of environment variables. Pure and testable. */
export function parseEnv(source: NodeJS.ProcessEnv): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue: any) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    );
  }
  return result.data;
}
