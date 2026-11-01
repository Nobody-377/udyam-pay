import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../../common/response';
import type { AdminService } from './admin.service';
import { requireRole } from '../auth/auth.middleware';

const verifyMerchantSchema = z.object({
  status: z.enum(['VERIFIED', 'SUSPENDED']),
  reason: z.string().optional(),
});

const resolveManualReviewSchema = z.object({
  decision: z.enum(['LENDER_PROCESSING', 'DECLINED', 'CANCELLED']),
  reason: z.string().min(3),
});

export function createAdminRouter(adminService: AdminService): Router {
  const router = Router();

  // All admin endpoints require administrator or ops authorization
  router.use(requireRole('ADMIN', 'SYSTEM_ADMIN', 'OPS_AGENT'));

  router.patch('/merchants/:id/status', async (req: Request, res: Response) => {
    const body = verifyMerchantSchema.parse(req.body);
    const updated =
      body.status === 'VERIFIED'
        ? await adminService.verifyMerchant(req.params.id!, req.user!.id)
        : await adminService.suspendMerchant(req.params.id!, body.reason ?? 'Administrative action', req.user!.id);

    sendSuccess(res, { merchant: updated });
  });

  router.put('/lenders/:id/config', async (req: Request, res: Response) => {
    const updated = await adminService.updateLenderConfig(req.params.id!, req.body, req.user!.id);
    sendSuccess(res, { config: updated });
  });

  router.get('/audit-logs', async (req: Request, res: Response) => {
    const entityType = req.query.entityType as string | undefined;
    const entityId = req.query.entityId as string | undefined;
    const result = await adminService.listAuditLogs(entityType, entityId);
    sendSuccess(res, result.items, { meta: { total: result.total } });
  });

  router.post('/applications/:id/manual-review', async (req: Request, res: Response) => {
    const body = resolveManualReviewSchema.parse(req.body);
    const updated = await adminService.resolveManualReview({
      applicationId: req.params.id!,
      decision: body.decision,
      reason: body.reason,
      adminUserId: req.user!.id,
    });
    sendSuccess(res, { application: updated });
  });

  return router;
}

