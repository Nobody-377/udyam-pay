import type { Express } from 'express';
import pino from 'pino';
import { createApp } from '../../src/app';
import { parseEnv } from '../../src/config/env';
import { AdminService } from '../../src/modules/admin/admin.service';
import { ApplicationService } from '../../src/modules/applications/application.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { CheckoutService } from '../../src/modules/checkout/checkout.service';
import { CommissionService } from '../../src/modules/ledger/commission.service';
import { MockLenderAdapter } from '../../src/modules/lenders/adapters/mock-lender';
import { OfferService } from '../../src/modules/offers/offer.service';
import { WaterfallOrchestrator } from '../../src/modules/orchestration/waterfall';
import { InMemoryStores } from '../../src/modules/persistence/in-memory-store';
import { WebhookService } from '../../src/modules/webhooks/webhook.service';

export interface FullTestAppContext {
  app: Express;
  stores: InMemoryStores;
  authService: AuthService;
  applicationService: ApplicationService;
  checkoutService: CheckoutService;
  offerService: OfferService;
  webhookService: WebhookService;
  commissionService: CommissionService;
  adminService: AdminService;
}

export function buildFullTestApp(): FullTestAppContext {
  process.env.DEV_DEFAULT_WEBHOOK_SECRET = 'lender-default-dev-secret';

  const stores = new InMemoryStores();
  const config = parseEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://test_user:test_pass@localhost:5432/test_db',
    CORS_ALLOWED_ORIGINS: 'https://merchant.example.com',
    DEV_DEFAULT_WEBHOOK_SECRET: 'lender-default-dev-secret',
  });

  const adapters = new Map();
  adapters.set(
    'LENDER_ALPHA',
    new MockLenderAdapter({
      code: 'LENDER_ALPHA',
      displayName: 'Alpha Digital Bank',
      defaultInterestRatePercent: 12.0,
      simulatedDelayMs: 0,
    }),
  );
  adapters.set(
    'LENDER_BETA',
    new MockLenderAdapter({
      code: 'LENDER_BETA',
      displayName: 'Beta Retail Finance NBFC',
      defaultInterestRatePercent: 14.0,
      simulatedDelayMs: 0,
    }),
  );

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
    logger: pino({ level: 'silent' }),
    readinessCheck: () => Promise.resolve(),
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

  return {
    app,
    stores,
    authService,
    applicationService,
    checkoutService,
    offerService,
    webhookService,
    commissionService,
    adminService,
  };
}

