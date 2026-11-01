import { Router, type Request, type Response } from 'express';
import { sendSuccess } from '../../common/response';
import type { WebhookService } from './webhook.service';

export function createWebhookRouter(webhookService: WebhookService): Router {
  const router = Router();

  // Public webhook ingestion endpoint for registered lenders
  router.post('/lenders/:code', async (req: Request, res: Response) => {
    const lenderCode = req.params.code!;
    const signatureHeader = req.headers['x-lender-signature'] as string | undefined;
    const timestampHeader = req.headers['x-lender-timestamp'] as string | undefined;

    // Use exact raw body buffer if captured by middleware for cryptographic verification
    const rawPayload =
      (req as any).rawBody ?? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));

    const result = await webhookService.processWebhook({
      lenderCode,
      rawPayload,
      signatureHeader,
      timestampHeader,
    });

    sendSuccess(res, {
      received: true,
      processed: result.processed,
      eventId: result.eventId,
      status: result.status,
      duplicate: result.duplicate,
    });
  });

  return router;
}

