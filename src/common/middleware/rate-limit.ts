import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { AppConfig } from '../../config/env';
import { TooManyRequestsError } from '../errors';

/**
 * Coarse per-IP limiter applied to the whole API. Stricter limiters (for
 * example login attempts) are added by the modules that need them.
 * The in-memory store is per-process; use a shared store if the API is ever
 * scaled to multiple instances.
 */
export function createGlobalRateLimiter(
  config: Pick<AppConfig, 'RATE_LIMIT_WINDOW_MS' | 'RATE_LIMIT_MAX'>,
): RequestHandler {
  return rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    limit: config.RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req: any, _res: any, next: any) => {
      next(new TooManyRequestsError());
    },
  });
}
