import { createHash, randomBytes } from 'node:crypto';
import { ConflictError, ForbiddenError, NotFoundError } from '../../common/errors';
import type {
  AppStores,
  CheckoutSessionEntity,
  PurchaseEntity,
} from '../persistence/stores';

export interface CreateCheckoutSessionParams {
  merchantId: string;
  shopId: string;
  purchaseId: string;
  createdByUserId?: string | null;
  validityMinutes?: number;
}

export interface CheckoutSessionDetails {
  session: CheckoutSessionEntity;
  purchase: PurchaseEntity;
  qrPayload: string;
  rawToken?: string;
}

export class CheckoutService {
  constructor(
    private readonly stores: AppStores,
    private readonly baseUrl = 'https://pay.udhyam.example',
  ) {}

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  async createSession(params: CreateCheckoutSessionParams): Promise<CheckoutSessionDetails> {
    const { merchantId, shopId, purchaseId, createdByUserId, validityMinutes = 30 } = params;

    const purchase = await this.stores.purchases.findById(purchaseId);
    if (!purchase) throw new NotFoundError('Purchase not found');
    if (purchase.merchantId !== merchantId) {
      throw new ForbiddenError('Purchase does not belong to this merchant');
    }

    const shop = await this.stores.shops.findById(shopId);
    if (!shop || shop.merchantId !== merchantId) {
      throw new ForbiddenError('Shop does not belong to this merchant');
    }

    // High entropy random token
    const rawToken = `cs_${randomBytes(24).toString('hex')}`;
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + validityMinutes * 60 * 1000);

    const session = await this.stores.checkoutSessions.create({
      merchantId,
      shopId,
      purchaseId,
      createdByUserId: createdByUserId ?? null,
      tokenHash,
      status: 'ACTIVE',
      expiresAt,
      consumedAt: null,
      revokedAt: null,
    });

    const qrPayload = `${this.baseUrl}/checkout/${rawToken}`;

    return {
      session,
      purchase,
      qrPayload,
      rawToken,
    };
  }

  async getSessionByToken(rawToken: string): Promise<CheckoutSessionDetails> {
    const tokenHash = this.hashToken(rawToken);
    const session = await this.stores.checkoutSessions.findByTokenHash(tokenHash);
    if (!session) {
      throw new NotFoundError('Checkout session not found');
    }

    const now = new Date();
    if (session.status === 'ACTIVE' && session.expiresAt < now) {
      await this.stores.checkoutSessions.markExpired(session.id);
      throw new ConflictError('Checkout session has expired');
    }

    if (session.status === 'EXPIRED') {
      throw new ConflictError('Checkout session has expired');
    }
    if (session.status === 'CONSUMED') {
      throw new ConflictError('Checkout session has already been used');
    }
    if (session.status === 'REVOKED') {
      throw new ConflictError('Checkout session has been revoked');
    }

    const purchase = await this.stores.purchases.findById(session.purchaseId);
    if (!purchase) throw new NotFoundError('Associated purchase not found');

    return {
      session,
      purchase,
      qrPayload: `${this.baseUrl}/checkout/${rawToken}`,
    };
  }

  async consumeSession(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    const session = await this.stores.checkoutSessions.findByTokenHash(tokenHash);
    if (!session) throw new NotFoundError('Checkout session not found');

    if (session.status !== 'ACTIVE') {
      throw new ConflictError(`Cannot consume session in status ${session.status}`);
    }

    await this.stores.checkoutSessions.markConsumed(session.id);
  }

  async revokeSession(sessionId: string, merchantId: string): Promise<void> {
    const session = await this.stores.checkoutSessions.findById(sessionId);
    if (!session) throw new NotFoundError('Checkout session not found');
    if (session.merchantId !== merchantId) {
      throw new ForbiddenError('Session does not belong to this merchant');
    }

    await this.stores.checkoutSessions.markRevoked(sessionId);
  }
}

