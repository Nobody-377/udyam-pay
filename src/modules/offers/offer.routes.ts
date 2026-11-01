import { Router, type Request, type Response } from 'express';
import { sendSuccess } from '../../common/response';
import type { OfferService } from './offer.service';

export function createOfferRouter(offerService: OfferService): Router {
  const router = Router();

  router.get('/applications/:id/offers', async (req: Request, res: Response) => {
    const offers = await offerService.listOffers(
      req.params.id!,
      req.user?.merchantId ?? undefined,
    );

    sendSuccess(
      res,
      offers.map((o) => ({
        ...o,
        principalPaise: o.principalPaise.toString(),
        emiPaise: o.emiPaise.toString(),
        totalRepayablePaise: o.totalRepayablePaise?.toString(),
        processingFeePaise: o.processingFeePaise?.toString(),
      })),
    );
  });

  router.post('/applications/:id/offers/:offerId/accept', async (req: Request, res: Response) => {
    const result = await offerService.acceptOffer({
      applicationId: req.params.id!,
      offerId: req.params.offerId!,
      customerId: undefined,
      actorType: req.user?.role === 'ADMIN' ? 'ADMIN_USER' : 'MERCHANT_USER',
      actorId: req.user?.id,
    });

    sendSuccess(res, {
      offer: {
        ...result.offer,
        principalPaise: result.offer.principalPaise.toString(),
        emiPaise: result.offer.emiPaise.toString(),
        downPaymentPaise: result.offer.downPaymentPaise?.toString() ?? null,
        processingFeePaise: result.offer.processingFeePaise?.toString() ?? null,
        totalRepayablePaise: result.offer.totalRepayablePaise?.toString() ?? null,
      },
      applicationStatus: result.applicationStatus,
    });
  });

  return router;
}

