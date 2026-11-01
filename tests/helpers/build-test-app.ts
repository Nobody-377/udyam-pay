import { Router, type Express } from 'express';
import pino from 'pino';
import { z } from 'zod';
import { createApp } from '../../src/app';
import { parseEnv, type AppConfig } from '../../src/config/env';
import type { ReadinessCheck } from '../../src/modules/health/health.routes';

export const ALLOWED_ORIGIN = 'https://merchant.example.com';

export function buildTestConfig(overrides: Record<string, string> = {}): AppConfig {
  return parseEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://test_user:test_pass@localhost:5432/test_db',
    CORS_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
    ...overrides,
  });
}

/** Routes that exist only in tests, to exercise the shared middleware stack. */
export function buildTestRouter(): Router {
  const router = Router();

  router.get('/ping', (_req: any, res: any) => {
    res.json({ success: true });
  });

  router.post('/echo', (req: any, res: any) => {
    res.json({ success: true, data: req.body ?? null });
  });

  router.post('/validate', (req: any, res: any) => {
    const body = z.object({ amountPaise: z.number().int().positive() }).parse(req.body);
    res.json({ success: true, data: body });
  });

  router.get('/boom', () => {
    throw new Error('secret-internal-detail');
  });

  router.get('/async-boom', async () => {
    throw new Error('secret-async-detail');
  });

  return router;
}

export interface BuildTestAppOptions {
  env?: Record<string, string>;
  readinessCheck?: ReadinessCheck;
  readinessTimeoutMs?: number;
}

export function buildTestApp(options: BuildTestAppOptions = {}): Express {
  return createApp({
    config: buildTestConfig(options.env),
    logger: pino({ level: 'silent' }),
    readinessCheck: options.readinessCheck ?? (() => Promise.resolve()),
    ...(options.readinessTimeoutMs !== undefined
      ? { readinessTimeoutMs: options.readinessTimeoutMs }
      : {}),
    apiRouter: buildTestRouter(),
  });
}
