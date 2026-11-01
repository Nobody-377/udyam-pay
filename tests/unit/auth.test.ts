import { describe, expect, it } from 'vitest';
import { AuthService } from '../../src/modules/auth/auth.service';
import { passwordHasher } from '../../src/modules/auth/password';
import { TokenService } from '../../src/modules/auth/token';
import { InMemoryStores } from '../../src/modules/persistence/in-memory-store';

describe('AuthService', () => {
  const JWT_SECRET = 'this-is-a-test-secret-at-least-32-chars-long!';

  async function setup() {
    const stores = new InMemoryStores();
    const authService = new AuthService(stores, JWT_SECRET);
    return { stores, authService };
  }

  it('registers merchant owner and creates initial merchant entity', async () => {
    const { authService, stores } = await setup();

    const { user, merchantId } = await authService.registerMerchantOwner({
      email: 'owner@retail.example',
      password: 'SecurePassword123!',
      legalName: 'Retail Corp',
      tradeName: 'Retail Electronics',
    });

    expect(user.role).toBe('MERCHANT_OWNER');
    expect(user.merchantId).toBe(merchantId);

    const savedMerchant = await stores.merchants.findById(merchantId);
    expect(savedMerchant?.status).toBe('PENDING_VERIFICATION');

    const isMatch = await passwordHasher.verify('SecurePassword123!', user.passwordHash);
    expect(isMatch).toBe(true);
  });

  it('logs in with correct password and issues valid JWT access token and refresh token', async () => {
    const { authService } = await setup();

    await authService.registerMerchantOwner({
      email: 'owner@retail.example',
      password: 'SecurePassword123!',
      legalName: 'Retail Corp',
    });

    const loginRes = await authService.login({
      email: 'owner@retail.example',
      password: 'SecurePassword123!',
    });

    expect(loginRes.tokens.accessToken).toBeTruthy();
    expect(loginRes.tokens.refreshToken.startsWith('rt_')).toBe(true);

    const tokenService = new TokenService(JWT_SECRET);
    const verified = tokenService.verifyAccessToken(loginRes.tokens.accessToken);
    expect(verified.sub).toBe(loginRes.user.id);
    expect(verified.role).toBe('MERCHANT_OWNER');
  });

  it('locks account after 5 consecutive failed logins', async () => {
    const { authService, stores } = await setup();

    await authService.registerMerchantOwner({
      email: 'owner@retail.example',
      password: 'SecurePassword123!',
      legalName: 'Retail Corp',
    });

    // 4 failed attempts
    for (let i = 0; i < 4; i++) {
      await expect(
        authService.login({ email: 'owner@retail.example', password: 'wrong' }),
      ).rejects.toThrow('Invalid email or password');
    }

    // 5th failed attempt triggers lock
    await expect(
      authService.login({ email: 'owner@retail.example', password: 'wrong' }),
    ).rejects.toThrow('Invalid email or password');

    const user = await stores.users.findByEmail('owner@retail.example');
    expect(user?.lockedUntil).toBeTruthy();
    expect(user?.failedLoginCount).toBe(5);

    // 6th attempt even with correct password is now blocked by lock
    await expect(
      authService.login({ email: 'owner@retail.example', password: 'SecurePassword123!' }),
    ).rejects.toThrow(/Account is locked/);
  });

  it('rotates refresh token and issues new tokens in same family', async () => {
    const { authService } = await setup();

    await authService.registerMerchantOwner({
      email: 'owner@retail.example',
      password: 'SecurePassword123!',
      legalName: 'Retail Corp',
    });

    const { tokens: initialTokens } = await authService.login({
      email: 'owner@retail.example',
      password: 'SecurePassword123!',
    });

    const refreshed = await authService.refreshTokens(initialTokens.refreshToken);
    expect(refreshed.accessToken).toBeTruthy();
    expect(refreshed.refreshToken).not.toBe(initialTokens.refreshToken);
  });

  it('detects refresh token reuse and revokes the entire family', async () => {
    const { authService, stores } = await setup();

    await authService.registerMerchantOwner({
      email: 'owner@retail.example',
      password: 'SecurePassword123!',
      legalName: 'Retail Corp',
    });

    const { tokens: initialTokens, user } = await authService.login({
      email: 'owner@retail.example',
      password: 'SecurePassword123!',
    });

    // Legitimate rotation
    const secondTokens = await authService.refreshTokens(initialTokens.refreshToken);

    // Attacker tries to use the old initialTokens.refreshToken again
    await expect(authService.refreshTokens(initialTokens.refreshToken)).rejects.toThrow(
      /Refresh token reuse detected/,
    );

    // Now even secondTokens is revoked because the whole family was revoked!
    await expect(authService.refreshTokens(secondTokens.refreshToken)).rejects.toThrow(
      /Refresh token reuse detected/,
    );

    // And user tokenVersion was bumped to invalidate existing access tokens
    const freshUser = await stores.users.findById(user.id);
    expect(freshUser?.tokenVersion).toBeGreaterThan(user.tokenVersion);
  });
});

