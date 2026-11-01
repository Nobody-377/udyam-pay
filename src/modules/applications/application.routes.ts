import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ForbiddenError } from '../../common/errors';
import { paginationQuerySchema, toSkipTake } from '../../common/pagination';
import { sendSuccess } from '../../common/response';
import type { ApplicationService } from './application.service';

const createApplicationSchema = z.object({
  shopId: z.string().uuid(),
  purchaseId: z.string().uuid(),
  customerId: z.string().uuid(),
  requestedAmountPaise: z.coerce.bigint().positive(),
  downPaymentPaise: z.coerce.bigint().min(0n).default(0n),
  requestedTenureMonths: z.number().int().min(1).max(36).optional(),
  routingMode: z.enum(['SEQUENTIAL', 'DISCOVERY']).default('SEQUENTIAL'),
  idempotencyKey: z.string().min(8).optional(),
});

const cancelApplicationSchema = z.object({
  reason: z.string().min(3).default('Customer requested cancellation'),
});

export function createApplicationRouter(applicationService: ApplicationService): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    if (!req.user?.merchantId) throw new ForbiddenError('Merchant association required');
    const idempotencyHeader = req.headers['idempotency-key'] as string | undefined;
    const rawBody = {
      ...req.body,
      idempotencyKey: idempotencyHeader || req.body.idempotencyKey,
    };
    const body = createApplicationSchema.parse(rawBody);

    const app = await applicationService.createApplication({
      merchantId: req.user.merchantId,
      shopId: body.shopId,
      purchaseId: body.purchaseId,
      customerId: body.customerId,
      requestedAmountPaise: body.requestedAmountPaise,
      downPaymentPaise: body.downPaymentPaise,
      requestedTenureMonths: body.requestedTenureMonths,
      routingMode: body.routingMode,
      idempotencyKey: body.idempotencyKey,
      createdByUserId: req.user.id,
    });

    sendSuccess(
      res,
      {
        application: {
          ...app,
          requestedAmountPaise: app.requestedAmountPaise.toString(),
          downPaymentPaise: app.downPaymentPaise.toString(),
        },
      },
      { status: 201 },
    );
  });

  router.post('/:id/submit', async (req: Request, res: Response) => {
    if (!req.user?.merchantId && req.user?.role !== 'ADMIN') {
      throw new ForbiddenError('Merchant or Admin role required');
    }

    const app = await applicationService.submitApplication({
      applicationId: req.params.id!,
      merchantId: req.user?.merchantId ?? undefined,
      actor: req.user?.role === 'ADMIN' ? 'ADMIN_USER' : 'MERCHANT_USER',
      actorId: req.user?.id,
    });

    sendSuccess(res, {
      application: {
        ...app,
        requestedAmountPaise: app.requestedAmountPaise.toString(),
        downPaymentPaise: app.downPaymentPaise.toString(),
      },
    });
  });

  router.post('/:id/cancel', async (req: Request, res: Response) => {
    const body = cancelApplicationSchema.parse(req.body);

    const app = await applicationService.cancelApplication({
      applicationId: req.params.id!,
      merchantId: req.user?.merchantId ?? undefined,
      actor: req.user?.role === 'ADMIN' ? 'ADMIN_USER' : 'MERCHANT_USER',
      actorId: req.user?.id,
      reason: body.reason,
    });

    sendSuccess(res, {
      application: {
        ...app,
        requestedAmountPaise: app.requestedAmountPaise.toString(),
        downPaymentPaise: app.downPaymentPaise.toString(),
      },
    });
  });

  router.get('/', async (req: Request, res: Response) => {
    if (!req.user?.merchantId) throw new ForbiddenError('Merchant association required');
    const query = paginationQuerySchema.parse(req.query);
    const { skip, take } = toSkipTake(query);
    const result = await applicationService.listApplications(req.user.merchantId, skip, take);

    sendSuccess(
      res,
      result.items.map((app) => ({
        ...app,
        requestedAmountPaise: app.requestedAmountPaise.toString(),
        downPaymentPaise: app.downPaymentPaise.toString(),
      })),
      { meta: { page: query.page, pageSize: query.pageSize, total: result.total } },
    );
  });

  router.get('/:id', async (req: Request, res: Response) => {
    const details = await applicationService.getApplication(
      req.params.id!,
      req.user?.merchantId ?? undefined,
    );

    sendSuccess(res, {
      application: {
        ...details.application,
        requestedAmountPaise: details.application.requestedAmountPaise.toString(),
        downPaymentPaise: details.application.downPaymentPaise.toString(),
      },
      offers: details.offers.map((o) => ({
        ...o,
        principalPaise: o.principalPaise.toString(),
        emiPaise: o.emiPaise.toString(),
        totalRepayablePaise: o.totalRepayablePaise?.toString(),
        processingFeePaise: o.processingFeePaise?.toString(),
      })),
      purchase: {
        ...details.purchase,
        amountPaise: details.purchase.amountPaise.toString(),
      },
      customer: details.customer,
    });
  });

  router.get('/:id/history', async (req: Request, res: Response) => {
    const history = await applicationService.getApplicationHistory(
      req.params.id!,
      req.user?.merchantId ?? undefined,
    );
    sendSuccess(res, { history });
  });

  return router;
}

