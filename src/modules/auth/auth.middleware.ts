import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../../common/errors';
import type { AppStores, MerchantStatus, UserRole } from '../persistence/stores';
import type { JwtPayload, TokenService } from './token';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  merchantId: string | null;
  tokenVersion: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function createAuthMiddleware(tokenService: TokenService, stores: AppStores): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      next(new UnauthorizedError('Missing or malformed Authorization header'));
      return;
    }

    const token = authHeader.substring(7).trim();
    let payload: JwtPayload;
    try {
      payload = tokenService.verifyAccessToken(token);
    } catch (err) {
      next(err);
      return;
    }

    // Verify token version in store to support instant revocation
    const user = await stores.users.findById(payload.sub);
    if (!user || user.status !== 'ACTIVE') {
      next(new UnauthorizedError('User account not found or suspended'));
      return;
    }

    if (user.tokenVersion !== payload.tokenVersion) {
      next(new UnauthorizedError('Token has been revoked'));
      return;
    }

    req.user = {
      id: user.id,
      role: user.role,
      merchantId: user.merchantId,
      tokenVersion: user.tokenVersion,
    };

    next();
  };
}

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError(`Action requires role: ${roles.join(' or ')}`));
      return;
    }
    next();
  };
}

export function requireMerchantStatus(stores: AppStores, ...statuses: MerchantStatus[]): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }
    const isPlatformAdmin =
      req.user.role === 'ADMIN' ||
      req.user.role === 'SYSTEM_ADMIN' ||
      req.user.role === 'OPS_AGENT';
    if (isPlatformAdmin) {
      next();
      return;
    }
    if (!req.user.merchantId) {
      next(new ForbiddenError('Merchant account association required'));
      return;
    }

    const merchant = await stores.merchants.findById(req.user.merchantId);
    if (!merchant) {
      next(new ForbiddenError('Merchant not found'));
      return;
    }

    if (!statuses.includes(merchant.status)) {
      next(
        new ForbiddenError(
          `Merchant is ${merchant.status}; required: ${statuses.join(' or ')}`,
        ),
      );
      return;
    }

    next();
  };
}
