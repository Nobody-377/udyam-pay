import { Router } from 'express';
import { createAdminRouter } from '../modules/admin/admin.routes';
import type { AdminService } from '../modules/admin/admin.service';
import { createApplicationRouter } from '../modules/applications/application.routes';
import type { ApplicationService } from '../modules/applications/application.service';
import { createAuthMiddleware } from '../modules/auth/auth.middleware';
import { createAuthRouter } from '../modules/auth/auth.routes';
import type { AuthService } from '../modules/auth/auth.service';
import type { TokenService } from '../modules/auth/token';
import { createCheckoutRouter } from '../modules/checkout/checkout.routes';
import type { CheckoutService } from '../modules/checkout/checkout.service';
import { createCustomerRouter } from '../modules/customers/customer.routes';
import { createLedgerRouter } from '../modules/ledger/ledger.routes';
import type { CommissionService } from '../modules/ledger/commission.service';
import { createMerchantRouter } from '../modules/merchants/merchant.routes';
import { createOfferRouter } from '../modules/offers/offer.routes';
import type { OfferService } from '../modules/offers/offer.service';
import type { AppStores } from '../modules/persistence/stores';
import { createPurchaseRouter } from '../modules/purchases/purchase.routes';
import { createWebhookRouter } from '../modules/webhooks/webhook.routes';
import type { WebhookService } from '../modules/webhooks/webhook.service';

export interface ApiV1RouterDeps {
  stores: AppStores;
  authService: AuthService;
  tokenService: TokenService;
  checkoutService: CheckoutService;
  applicationService: ApplicationService;
  offerService: OfferService;
  webhookService: WebhookService;
  commissionService: CommissionService;
  adminService: AdminService;
}

/**
 * Root router mounted at /api/v1.
 * Wires authentication, role enforcement, and module endpoints.
 */
export function createApiV1Router(deps?: ApiV1RouterDeps): Router {
  const router = Router();
  if (!deps) return router;

  const authMiddleware = createAuthMiddleware(deps.tokenService, deps.stores);

  // 1. Unauthenticated endpoints
  router.use('/auth', createAuthRouter(deps.authService));
  router.use('/webhooks', createWebhookRouter(deps.webhookService));
  // Mount checkout router so public GET /checkout/sessions/:token is accessible before auth,
  // while POST /checkout/sessions requires merchant authorization
  router.use('/checkout', createCheckoutRouter(deps.checkoutService, authMiddleware));

  // 2. Protected endpoints (require Bearer JWT)
  router.use(authMiddleware);

  router.use('/merchants', createMerchantRouter(deps.stores));
  router.use('/customers', createCustomerRouter(deps.stores));
  router.use('/purchases', createPurchaseRouter(deps.stores));
  router.use('/applications', createApplicationRouter(deps.applicationService));
  router.use('/', createOfferRouter(deps.offerService));
  router.use('/ledger', createLedgerRouter(deps.commissionService));
  router.use('/admin', createAdminRouter(deps.adminService));

  return router;
}
