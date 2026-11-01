import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ForbiddenError, NotFoundError } from '../../common/errors';
import { sendSuccess } from '../../common/response';
import type { AppStores } from '../persistence/stores';

const createShopSchema = z.object({
  name: z.string().min(2),
  city: z.string().min(2),
  state: z.string().min(2),
});

export function createMerchantRouter(stores: AppStores): Router {
  const router = Router();

  router.get('/me', async (req: Request, res: Response) => {
    if (!req.user?.merchantId) throw new ForbiddenError('Merchant association required');
    const merchant = await stores.merchants.findById(req.user.merchantId);
    if (!merchant) throw new NotFoundError('Merchant not found');
    sendSuccess(res, { merchant });
  });

  router.post('/shops', async (req: Request, res: Response) => {
    if (!req.user?.merchantId) throw new ForbiddenError('Merchant association required');
    const body = createShopSchema.parse(req.body);
    const shop = await stores.shops.create({
      merchantId: req.user.merchantId,
      name: body.name,
      city: body.city,
      state: body.state,
      status: 'ACTIVE',
    });
    sendSuccess(res, { shop }, { status: 201 });
  });

  router.get('/shops', async (req: Request, res: Response) => {
    if (!req.user?.merchantId) throw new ForbiddenError('Merchant association required');
    const shops = await stores.shops.listByMerchant(req.user.merchantId);
    sendSuccess(res, { shops });
  });

  return router;
}

