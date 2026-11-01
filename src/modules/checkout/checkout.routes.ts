import { Router, type Request, type Response, type RequestHandler } from 'express';
import { z } from 'zod';
import { ForbiddenError } from '../../common/errors';
import { sendSuccess } from '../../common/response';
import type { CheckoutService } from './checkout.service';

const createSessionSchema = z.object({
  shopId: z.string().uuid(),
  purchaseId: z.string().uuid(),
  validityMinutes: z.number().int().min(5).max(120).default(30),
});

export function createCheckoutRouter(
  checkoutService: CheckoutService,
  authMiddleware?: RequestHandler,
): Router {
  const router = Router();

  const sessionHandlers: RequestHandler[] = authMiddleware ? [authMiddleware] : [];

  // Protected: merchant creates session and generates QR
  router.post('/sessions', ...sessionHandlers, async (req: Request, res: Response) => {
    if (!req.user?.merchantId) throw new ForbiddenError('Merchant association required');
    const body = createSessionSchema.parse(req.body);

    const details = await checkoutService.createSession({
      merchantId: req.user.merchantId,
      shopId: body.shopId,
      purchaseId: body.purchaseId,
      createdByUserId: req.user.id,
      validityMinutes: body.validityMinutes,
    });

    sendSuccess(
      res,
      {
        sessionId: details.session.id,
        status: details.session.status,
        expiresAt: details.session.expiresAt,
        qrPayload: details.qrPayload,
        rawToken: details.rawToken,
        purchase: {
          ...details.purchase,
          amountPaise: details.purchase.amountPaise.toString(),
        },
      },
      { status: 201 },
    );
  });

  // Public: customer scans QR code to fetch checkout details
  router.get('/sessions/:token', async (req: Request, res: Response) => {
    const rawToken = req.params.token!;
    const details = await checkoutService.getSessionByToken(rawToken);

    sendSuccess(res, {
      sessionId: details.session.id,
      status: details.session.status,
      expiresAt: details.session.expiresAt,
      purchase: {
        id: details.purchase.id,
        productCategory: details.purchase.productCategory,
        productDescription: details.purchase.productDescription,
        amountPaise: details.purchase.amountPaise.toString(),
        currency: details.purchase.currency,
      },
    });
  });

  return router;
}

