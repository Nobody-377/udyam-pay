import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Per-request structured logging. Assigns a request id (honouring a
 * well-formed inbound X-Request-Id, otherwise generating one), echoes it in the
 * response, and logs only method and path: never headers, query strings or
 * bodies, which can carry tokens and personal data.
 */
export function createHttpLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: (req: any, res: any) => {
      const inbound = req.headers['x-request-id'];
      const id =
        typeof inbound === 'string' && REQUEST_ID_PATTERN.test(inbound) ? inbound : randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    customLogLevel: (_req: any, res: any, error: any) => {
      if (error !== undefined || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    autoLogging: {
      ignore: (req: any) => req.url === '/health' || req.url === '/ready',
    },
    serializers: {
      req: (req: { id?: unknown; method?: string; url?: string }) => ({
        id: req.id,
        method: req.method,
        path: typeof req.url === 'string' ? req.url.split('?')[0] : undefined,
      }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
  });
}
