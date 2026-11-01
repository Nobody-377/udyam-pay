import { PrismaClient } from '@prisma/client';
import type { AppConfig } from './env';

/**
 * Creates the single PrismaClient used by the process. Requires
 * `npm run prisma:generate` to have been run first.
 *
 * Only warnings and errors are logged by Prisma itself; query logging is left
 * off so statement parameters (which may contain personal data) are never
 * written to the logs.
 */
export function createPrismaClient(config: Pick<AppConfig, 'DATABASE_URL'>): PrismaClient {
  return new PrismaClient({
    datasourceUrl: config.DATABASE_URL,
    log: ['warn', 'error'],
  });
}
