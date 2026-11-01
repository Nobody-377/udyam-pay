import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ForbiddenError, NotFoundError } from '../../common/errors';
import { sendSuccess } from '../../common/response';
import type { AppStores } from '../persistence/stores';

const registerCustomerSchema = z.object({
  fullName: z.string().min(2),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Must be valid E.164 phone number, e.g. +919876543210'),
  consentNoticeVersion: z.string().default('v1.0'),
  captureMethod: z.enum(['CUSTOMER_CHECKOUT_SESSION', 'MERCHANT_ASSISTED']).default('CUSTOMER_CHECKOUT_SESSION'),
});

const grantConsentSchema = z.object({
  purpose: z.enum(['FINANCING_APPLICATION_PROCESSING', 'LENDER_DATA_SHARING']),
  noticeVersion: z.string().default('v1.0'),
  captureMethod: z.enum(['CUSTOMER_CHECKOUT_SESSION', 'MERCHANT_ASSISTED']).default('CUSTOMER_CHECKOUT_SESSION'),
});

export function createCustomerRouter(stores: AppStores): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    if (!req.user?.merchantId) throw new ForbiddenError('Merchant association required');
    const body = registerCustomerSchema.parse(req.body);

    let customer = await stores.customers.findByPhone(req.user.merchantId, body.phone);
    if (!customer) {
      customer = await stores.customers.create({
        merchantId: req.user.merchantId,
        fullName: body.fullName,
        phone: body.phone,
        retentionExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year retention
        anonymizedAt: null,
      });
    }

    // Record consent
    const consent = await stores.consents.create({
      merchantId: req.user.merchantId,
      customerId: customer.id,
      purpose: 'FINANCING_APPLICATION_PROCESSING',
      noticeVersion: body.consentNoticeVersion,
      captureMethod: body.captureMethod,
      grantedAt: new Date(),
      revokedAt: null,
    });

    sendSuccess(res, { customer, consent }, { status: 201 });
  });

  router.post('/:id/consents', async (req: Request, res: Response) => {
    if (!req.user?.merchantId) throw new ForbiddenError('Merchant association required');
    const customer = await stores.customers.findById(req.params.id!);
    if (!customer || customer.merchantId !== req.user.merchantId) {
      throw new NotFoundError('Customer not found');
    }

    const body = grantConsentSchema.parse(req.body);
    const consent = await stores.consents.create({
      merchantId: req.user.merchantId,
      customerId: customer.id,
      purpose: body.purpose,
      noticeVersion: body.noticeVersion,
      captureMethod: body.captureMethod,
      grantedAt: new Date(),
      revokedAt: null,
    });

    sendSuccess(res, { consent }, { status: 201 });
  });

  router.delete('/:id/consents/:consentId', async (req: Request, res: Response) => {
    if (!req.user?.merchantId) throw new ForbiddenError('Merchant association required');
    const customer = await stores.customers.findById(req.params.id!);
    if (!customer || customer.merchantId !== req.user.merchantId) {
      throw new NotFoundError('Customer not found');
    }

    await stores.consents.revoke(req.params.consentId!);
    sendSuccess(res, { message: 'Consent revoked successfully' });
  });

  return router;
}

