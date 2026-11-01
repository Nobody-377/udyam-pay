import { Router } from 'express';
import type { Logger } from 'pino';
import { withTimeout } from '../../common/async';

/** Resolves when dependencies are reachable; rejects otherwise. */
export type ReadinessCheck = () => Promise<void>;

export interface HealthRouterDeps {
  readinessCheck: ReadinessCheck;
  readinessTimeoutMs: number;
  logger: Logger;
}

/**
 * /health: liveness only. Does not touch dependencies.
 * /ready:  readiness. Verifies dependencies (database) within a time limit.
 * Both return minimal plain JSON and never include error details.
 */
export function createHealthRouter(deps: HealthRouterDeps): Router {
  const router = Router();

  router.get('/health', (_req: any, res: any) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ status: 'ok', uptimeSeconds: Math.floor(process.uptime()) });
  });

  router.get('/ready', async (_req: any, res: any) => {
    res.set('Cache-Control', 'no-store');
    try {
      await withTimeout(Promise.resolve().then(deps.readinessCheck), deps.readinessTimeoutMs);
      res.status(200).json({ status: 'ready' });
    } catch (error) {
      deps.logger.warn({ err: error }, 'Readiness check failed');
      res.status(503).json({ status: 'unavailable' });
    }
  });

  return router;
}
