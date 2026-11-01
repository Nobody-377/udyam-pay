import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ForbiddenError, NotFoundError } from '../../common/errors';
import { paginationQuerySchema, toSkipTake } from '../../common/pagination';
import { sendSuccess } from '../../common/response';
import type { AppStores } from '../persistence/stores';

const createPurchaseSchema = z.object({
  shopId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  productCategory: z.enum([
    'SMARTPHONE',
    'TELEVISION',
    'REFRIGERATOR',
    'WASHING_MACHINE',
    'AIR_CONDITIONER',
    'LAPTOP',
    'OTHER_ELECTRONICS',
  ]),
  productDescription: z.string().max(255).optional(),
  amountPaise: z.coerce.bigint().positive('Amount must be positive'),
  currency: z.string().default('INR'),
  idempotencyKey: z.string().min(8),
});

export function createPurchaseRouter(stores: AppStores): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    if (!req.user?.merchantId) throw new ForbiddenError('Merchant association required');
    const idempotencyHeader = req.headers['idempotency-key'] as string | undefined;
    const rawBody = {
      ...req.body,
      idempotencyKey: idempotencyHeader || req.body.idempotencyKey,
    };
    const body = createPurchaseSchema.parse(rawBody);

    const purchase = await stores.purchases.createIdempotent({
      merchantId: req.user.merchantId,
      shopId: body.shopId,
      customerId: body.customerId ?? null,
      productCategory: body.productCategory,
      productDescription: body.productDescription ?? null,
      amountPaise: body.amountPaise,
      currency: body.currency,
      idempotencyKey: body.idempotencyKey,
    });

    sendSuccess(
      res,
      {
        purchase: {
          ...purchase,
          amountPaise: purchase.amountPaise.toString(),
        },
      },
      { status: 201 },
    );
  });

  router.get('/', async (req: Request, res: Response) => {
    if (!req.user?.merchantId) throw new ForbiddenError('Merchant association required');
    const query = paginationQuerySchema.parse(req.query);
    const { skip, take } = toSkipTake(query);
    const result = await stores.purchases.listByMerchant(req.user.merchantId, skip, take);

    sendSuccess(
      res,
      result.items.map((p) => ({
        ...p,
        amountPaise: p.amountPaise.toString(),
      })),
      { meta: { page: query.page, pageSize: query.pageSize, total: result.total } },
    );
  });

  router.get('/:id', async (req: Request, res: Response) => {
    if (!req.user?.merchantId) throw new ForbiddenError('Merchant association required');
    const purchase = await stores.purchases.findById(req.params.id!);
    if (!purchase || purchase.merchantId !== req.user.merchantId) {
      throw new NotFoundError('Purchase not found');
    }

    sendSuccess(res, {
      purchase: {
        ...purchase,
        amountPaise: purchase.amountPaise.toString(),
      },
    });
  });

  return router;
}

