import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { UnauthorizedError } from '../../common/errors';
import type { UserRole } from '../persistence/stores';

export interface JwtPayload {
  sub: string;
  role: UserRole;
  merchantId: string | null;
  tokenVersion: number;
  iat: number;
  exp: number;
}

export function base64UrlEncode(str: string | Buffer): string {
  const buf = typeof str === 'string' ? Buffer.from(str) : str;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

export class TokenService {
  constructor(
    private readonly jwtSecret: string,
    private readonly accessExpirySeconds = 900, // 15 mins
  ) {}

  signAccessToken(params: {
    userId: string;
    role: UserRole;
    merchantId: string | null;
    tokenVersion: number;
  }): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload: JwtPayload = {
      sub: params.userId,
      role: params.role,
      merchantId: params.merchantId,
      tokenVersion: params.tokenVersion,
      iat: now,
      exp: now + this.accessExpirySeconds,
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = createHmac('sha256', this.jwtSecret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest();

    return `${encodedHeader}.${encodedPayload}.${base64UrlEncode(signature)}`;
  }

  verifyAccessToken(token: string): JwtPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedError('Malformed access token');
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    if (!headerB64 || !payloadB64 || !signatureB64) {
      throw new UnauthorizedError('Malformed access token parts');
    }

    const expectedSignature = createHmac('sha256', this.jwtSecret)
      .update(`${headerB64}.${payloadB64}`)
      .digest();

    const actualSignature = Buffer.from(
      signatureB64.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - (signatureB64.length % 4)) % 4),
      'base64',
    );

    if (
      expectedSignature.length !== actualSignature.length ||
      !timingSafeEqual(new Uint8Array(expectedSignature), new Uint8Array(actualSignature))
    ) {
      throw new UnauthorizedError('Invalid token signature');
    }

    try {
      const payload: JwtPayload = JSON.parse(base64UrlDecode(payloadB64));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp < now) {
        throw new UnauthorizedError('Access token has expired');
      }
      return payload;
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      throw new UnauthorizedError('Invalid token payload');
    }
  }

  generateRefreshToken(): { rawToken: string; tokenHash: string } {
    const rawToken = `rt_${randomBytes(32).toString('hex')}`;
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    return { rawToken, tokenHash };
  }

  hashRefreshToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}

