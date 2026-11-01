import pino, { type Logger, type LoggerOptions } from 'pino';
import type { AppConfig } from './env';

/**
 * Field paths whose values must never reach the logs. pino wildcards match a
 * single level, so common keys are listed at the top level and one and two
 * levels deep. Personal data of customers and merchants is redacted as well.
 */
const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'otp',
  'secret',
  'clientSecret',
  'apiKey',
  'authorization',
  'cookie',
  'email',
  'phone',
  'fullName',
] as const;

export const REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((key) => `*.${key}`),
  ...SENSITIVE_KEYS.map((key) => `*.*.${key}`),
];

export function buildLoggerOptions(
  config: Pick<AppConfig, 'NODE_ENV' | 'LOG_LEVEL' | 'LOG_PRETTY'>,
): LoggerOptions {
  const options: LoggerOptions = {
    level: config.LOG_LEVEL,
    base: { service: 'udyam-pay-backend', env: config.NODE_ENV },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  };

  if (config.LOG_PRETTY && config.NODE_ENV !== 'production') {
    options.transport = { target: 'pino-pretty', options: { colorize: true } };
  }
  return options;
}

export function createLogger(
  config: Pick<AppConfig, 'NODE_ENV' | 'LOG_LEVEL' | 'LOG_PRETTY'>,
): Logger {
  return pino(buildLoggerOptions(config));
}
