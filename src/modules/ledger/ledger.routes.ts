import { Router, type Request, type Response } from 'express';
import { ForbiddenError } from '../../common/errors';
import { sendSuccess } from '../../common/response';
import type { CommissionService } from './commission.service';

export function createLedgerRouter(commissionService: CommissionService): Router {
  const router = Router();

  router.get('/commission', async (req: Request, res: Response) => {
    const userRole = req.user?.role;
    const isPlatformAdmin =
      userRole === 'ADMIN' || userRole === 'SYSTEM_ADMIN' || userRole === 'OPS_AGENT';
    const isMerchantUser = userRole === 'MERCHANT_OWNER' || userRole === 'MERCHANT_STAFF';

    if (!isPlatformAdmin && !isMerchantUser) {
      throw new ForbiddenError('Merchant or Admin authorization required');
    }

    let merchantId: string | undefined;

    if (isMerchantUser) {
      // Merchant users are strictly isolated to their own authenticated merchant
      merchantId = req.user?.merchantId ?? undefined;
      if (!merchantId) {
        throw new ForbiddenError('Merchant user is not associated with an active merchant');
      }
      // Explicitly reject query parameter tampering
      if (req.query.merchantId && req.query.merchantId !== merchantId) {
        throw new ForbiddenError('Access denied: merchant mismatch');
      }
    } else if (isPlatformAdmin) {
      merchantId = (req.query.merchantId as string) || req.user?.merchantId || undefined;
      if (!merchantId) {
        throw new ForbiddenError('merchantId query parameter is required for platform administrators');
      }
    }

    const skip = req.query.skip ? parseInt(req.query.skip as string, 10) : 0;
    const take = req.query.take ? parseInt(req.query.take as string, 10) : 50;

    const summary = await commissionService.getMerchantSummary(merchantId!, skip, take);

    sendSuccess(res, {
      summary: {
        totalAccruedPaise: summary.totalAccruedPaise.toString(),
        totalReversedPaise: summary.totalReversedPaise.toString(),
        netCommissionPaise: summary.netCommissionPaise.toString(),
        entries: summary.entries.map((e) => ({
          ...e,
          amountPaise: e.amountPaise.toString(),
        })),
      },
    });
  });

  return router;
}

