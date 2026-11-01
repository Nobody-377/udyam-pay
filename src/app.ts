import cors from 'cors';
import express, { type Express, type Router } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { createErrorHandler, notFoundHandler } from './common/middleware/error-handler';
import { createHttpLogger } from './common/middleware/http-logger';
import { createGlobalRateLimiter } from './common/middleware/rate-limit';
import type { AppConfig } from './config/env';
import { createHealthRouter, type ReadinessCheck } from './modules/health/health.routes';
import { createApiV1Router, type ApiV1RouterDeps } from './routes';

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  readinessCheck: ReadinessCheck;
  readinessTimeoutMs?: number;
  /** Inject full feature module router dependencies */
  routerDeps?: ApiV1RouterDeps;
  /** Override the /api/v1 router (used by tests). */
  apiRouter?: Router;
}

/**
 * Builds the Express application. All dependencies are injected so the app can
 * be tested without a database, real environment variables or open ports.
 */
export function createApp(deps: AppDependencies): Express {
  const { config, logger } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);

  app.use(createHttpLogger(logger));
  app.use(helmet());

  const allowedOrigins = new Set(config.CORS_ALLOWED_ORIGINS);
  app.use(
    cors({
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Requests without an Origin header (server-to-server, curl) are not browser CORS requests.
        callback(null, origin === undefined || allowedOrigins.has(origin));
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      credentials: false,
      maxAge: 600,
    }),
  );

  // Health endpoints sit before the rate limiter so orchestrators can always probe.
  app.use(
    createHealthRouter({
      readinessCheck: deps.readinessCheck,
      readinessTimeoutMs: deps.readinessTimeoutMs ?? 2000,
      logger,
    }),
  );

  app.use(createGlobalRateLimiter(config));
  app.use(
    express.json({
      limit: config.REQUEST_BODY_LIMIT,
      strict: true,
      verify: (req: any, _res: any, buf: Buffer) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
  );

  // OpenAPI Specification route
  app.get('/docs', async (_req: any, res: any) => {
    try {
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const spec = JSON.parse(readFileSync(resolve(process.cwd(), 'src/docs/openapi.json'), 'utf8'));
      res.status(200).json(spec);
    } catch {
      res.status(200).json({ openapi: '3.1.0', info: { title: 'Udhyam PAY' } });
    }
  });
  app.get('/api/docs', async (_req: any, res: any) => {
    try {
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const spec = JSON.parse(readFileSync(resolve(process.cwd(), 'src/docs/openapi.json'), 'utf8'));
      res.status(200).json(spec);
    } catch {
      res.status(200).json({ openapi: '3.1.0', info: { title: 'Udhyam PAY' } });
    }
  });

  app.use('/api/v1', deps.apiRouter ?? createApiV1Router(deps.routerDeps));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
