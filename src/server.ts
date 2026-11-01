import dotenv from 'dotenv';
import { createApp } from './app';
import { EnvValidationError, parseEnv, type AppConfig } from './config/env';
import { createLogger } from './config/logger';
import { createPrismaClient } from './config/prisma';
import { AdminService } from './modules/admin/admin.service';
import { ApplicationService } from './modules/applications/application.service';
import { AuthService } from './modules/auth/auth.service';
import { CheckoutService } from './modules/checkout/checkout.service';
import { CommissionService } from './modules/ledger/commission.service';
import { createLenderAdapters } from './modules/lenders/provider-factory';
import { OfferService } from './modules/offers/offer.service';
import { WaterfallOrchestrator } from './modules/orchestration/waterfall';
import { PrismaStore } from './modules/persistence/prisma-store';
import { WebhookService } from './modules/webhooks/webhook.service';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function main(): void {
  dotenv.config();

  let config: AppConfig;
  try {
    config = parseEnv(process.env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger(config);
  const prisma = createPrismaClient(config);

  // Persistence
  const stores = new PrismaStore(prisma);

  // Lender Adapters
  const adapters = createLenderAdapters(config);

  // Domain Services
  const waterfall = new WaterfallOrchestrator(stores, adapters);
  const authService = new AuthService(stores, config.JWT_SECRET);
  const applicationService = new ApplicationService(stores, waterfall);
  const checkoutService = new CheckoutService(stores);
  const offerService = new OfferService(stores);
  const webhookService = new WebhookService(stores, config.WEBHOOK_DEFAULT_TOLERANCE_SECONDS);
  const commissionService = new CommissionService(stores);
  const adminService = new AdminService(stores);

  const app = createApp({
    config,
    logger,
    readinessCheck: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    routerDeps: {
      stores,
      authService,
      tokenService: authService.getTokenService(),
      checkoutService,
      applicationService,
      offerService,
      webhookService,
      commissionService,
      adminService,
    },
  });

  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'Udhyam PAY backend listening');
  });

  let shuttingDown = false;
  const shutdown = (reason: string, exitCode: number): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ reason }, 'Shutting down');

    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close(() => {
      prisma
        .$disconnect()
        .catch((error: unknown) => logger.error({ err: error }, 'Error disconnecting database'))
        .finally(() => process.exit(exitCode));
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM', 0));
  process.on('SIGINT', () => shutdown('SIGINT', 0));
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    shutdown('uncaughtException', 1);
  });
}

main();
