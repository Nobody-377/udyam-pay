import { randomUUID } from 'node:crypto';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
} from '../../common/errors';
import type { AppStores, UserEntity } from '../persistence/stores';
import { passwordHasher, type PasswordHasher } from './password';
import { TokenService } from './token';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RegisterOwnerParams {
  email: string;
  password: string;
  legalName: string;
  tradeName?: string;
}

export interface LoginParams {
  email: string;
  password: string;
  userAgent?: string;
}

export class AuthService {
  private readonly tokenService: TokenService;
  private readonly hasher: PasswordHasher;

  constructor(
    private readonly stores: AppStores,
    jwtSecret: string,
    hasher: PasswordHasher = passwordHasher,
  ) {
    this.tokenService = new TokenService(jwtSecret);
    this.hasher = hasher;
  }

  async registerMerchantOwner(params: RegisterOwnerParams): Promise<{ user: UserEntity; merchantId: string }> {
    const existing = await this.stores.users.findByEmail(params.email);
    if (existing) {
      throw new ConflictError('User with this email already exists');
    }

    const merchant = await this.stores.merchants.create({
      legalName: params.legalName,
      tradeName: params.tradeName ?? null,
      status: 'PENDING_VERIFICATION',
      verifiedAt: null,
      suspendedAt: null,
      suspensionReason: null,
    });

    const passwordHash = await this.hasher.hash(params.password);
    const user = await this.stores.users.create({
      email: params.email,
      passwordHash,
      role: 'MERCHANT_OWNER',
      status: 'ACTIVE',
      merchantId: merchant.id,
      tokenVersion: 0,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
    });

    return { user, merchantId: merchant.id };
  }

  async login(params: LoginParams): Promise<{ user: UserEntity; tokens: AuthTokens }> {
    const user = await this.stores.users.findByEmail(params.email);
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenError('Account is suspended');
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      const waitMinutes = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60000);
      throw new AppError({
        statusCode: 423,
        code: 'ACCOUNT_LOCKED',
        message: `Account is locked due to too many failed attempts. Try again in ${waitMinutes} minute(s).`,
      });
    }

    const isMatch = await this.hasher.verify(params.password, user.passwordHash);
    if (!isMatch) {
      const newFailCount = user.failedLoginCount + 1;
      let lockUntil: Date | undefined;
      if (newFailCount >= 5) {
        lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min lockout
      }
      await this.stores.users.incrementFailedLogin(user.id, lockUntil);
      throw new UnauthorizedError('Invalid email or password');
    }

    // Reset lock and update last login
    await this.stores.users.resetFailedLogin(user.id);
    await this.stores.users.updateLastLogin(user.id);

    // Issue tokens
    const accessToken = this.tokenService.signAccessToken({
      userId: user.id,
      role: user.role,
      merchantId: user.merchantId,
      tokenVersion: user.tokenVersion,
    });

    const { rawToken, tokenHash } = this.tokenService.generateRefreshToken();
    const familyId = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await this.stores.refreshSessions.create({
      userId: user.id,
      familyId,
      tokenHash,
      expiresAt,
      revokedAt: null,
      replacedById: null,
      userAgent: params.userAgent ?? null,
    });

    return {
      user,
      tokens: {
        accessToken,
        refreshToken: rawToken,
        expiresIn: 900,
      },
    };
  }

  async refreshTokens(rawRefreshToken: string, userAgent?: string): Promise<AuthTokens> {
    const tokenHash = this.tokenService.hashRefreshToken(rawRefreshToken);
    const session = await this.stores.refreshSessions.findByTokenHash(tokenHash);

    if (!session) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    // Reuse detection: if already revoked or replaced, this is a token theft replay!
    if (session.revokedAt || session.replacedById) {
      // Revoke the entire family immediately
      await this.stores.refreshSessions.revokeFamily(session.familyId);
      // Increment token version to invalidate access tokens
      await this.stores.users.incrementTokenVersion(session.userId);
      throw new UnauthorizedError('Refresh token reuse detected: session revoked');
    }

    const now = new Date();
    if (session.expiresAt < now) {
      throw new UnauthorizedError('Refresh token has expired');
    }

    const user = await this.stores.users.findById(session.userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedError('User account inactive or removed');
    }

    // Rotate refresh session
    const { rawToken: newRawToken, tokenHash: newTokenHash } = this.tokenService.generateRefreshToken();
    const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await this.stores.refreshSessions.rotateSession(session.id, {
      userId: user.id,
      familyId: session.familyId,
      tokenHash: newTokenHash,
      expiresAt: newExpiresAt,
      revokedAt: null,
      replacedById: null,
      userAgent: userAgent ?? session.userAgent,
    });

    const accessToken = this.tokenService.signAccessToken({
      userId: user.id,
      role: user.role,
      merchantId: user.merchantId,
      tokenVersion: user.tokenVersion,
    });

    return {
      accessToken,
      refreshToken: newRawToken,
      expiresIn: 900,
    };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = this.tokenService.hashRefreshToken(rawRefreshToken);
    const session = await this.stores.refreshSessions.findByTokenHash(tokenHash);
    if (session) {
      await this.stores.refreshSessions.revokeFamily(session.familyId);
    }
  }

  getTokenService(): TokenService {
    return this.tokenService;
  }
}

