import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../../src/config/env';

const VALID_URL = 'postgresql://user:s3cretpass@localhost:5432/udyam';

describe('parseEnv', () => {
  it('applies defaults when only DATABASE_URL is provided', () => {
    const config = parseEnv({ DATABASE_URL: VALID_URL });

    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3000);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.LOG_PRETTY).toBe(false);
    expect(config.TRUST_PROXY).toBe(0);
    expect(config.CORS_ALLOWED_ORIGINS).toEqual([]);
    expect(config.REQUEST_BODY_LIMIT).toBe('100kb');
  });

  it('coerces numeric values from strings', () => {
    const config = parseEnv({ DATABASE_URL: VALID_URL, PORT: '8080', RATE_LIMIT_MAX: '10' });

    expect(config.PORT).toBe(8080);
    expect(config.RATE_LIMIT_MAX).toBe(10);
  });

  it('parses a comma-separated origin list', () => {
    const config = parseEnv({
      DATABASE_URL: VALID_URL,
      CORS_ALLOWED_ORIGINS: 'https://a.example.com, http://localhost:5173',
    });

    expect(config.CORS_ALLOWED_ORIGINS).toEqual(['https://a.example.com', 'http://localhost:5173']);
  });

  it.each(['*', 'https://a.example.com/', 'https://a.example.com/path', 'not-a-url'])(
    'rejects invalid CORS origin %s',
    (origin) => {
      expect(() => parseEnv({ DATABASE_URL: VALID_URL, CORS_ALLOWED_ORIGINS: origin })).toThrow(
        EnvValidationError,
      );
    },
  );

  it('requires DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(EnvValidationError);
  });

  it('rejects non-PostgreSQL URLs', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://u:p@localhost/db' })).toThrow(
      EnvValidationError,
    );
  });

  it('rejects an out-of-range PORT', () => {
    expect(() => parseEnv({ DATABASE_URL: VALID_URL, PORT: '70000' })).toThrow(EnvValidationError);
  });

  it('rejects pretty logging in production', () => {
    expect(() =>
      parseEnv({ DATABASE_URL: VALID_URL, NODE_ENV: 'production', LOG_PRETTY: 'true' }),
    ).toThrow(EnvValidationError);
  });

  it('never includes values (such as database passwords) in the error message', () => {
    try {
      parseEnv({ DATABASE_URL: 'mysql://user:s3cretpass@localhost/db', PORT: 'abc' });
      expect.unreachable('parseEnv should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('PORT');
      expect(message).not.toContain('s3cretpass');
    }
  });

  describe('JWT_SECRET production security requirements', () => {
    const PROD_VALID_SECRET = 'this-is-a-valid-production-secret-min-32-chars-long!';

    it('rejects missing JWT_SECRET in production', () => {
      expect(() =>
        parseEnv({
          DATABASE_URL: VALID_URL,
          NODE_ENV: 'production',
        }),
      ).toThrow(EnvValidationError);
    });

    it('rejects known development default JWT_SECRET in production', () => {
      expect(() =>
        parseEnv({
          DATABASE_URL: VALID_URL,
          NODE_ENV: 'production',
          JWT_SECRET: 'udyam-pay-dev-super-secret-jwt-key-min-32-chars!',
        }),
      ).toThrow(EnvValidationError);
    });

    it('rejects too short JWT_SECRET (< 32 characters)', () => {
      expect(() =>
        parseEnv({
          DATABASE_URL: VALID_URL,
          NODE_ENV: 'production',
          JWT_SECRET: 'too-short-secret',
        }),
      ).toThrow(EnvValidationError);
    });

    it('accepts valid explicitly configured JWT_SECRET in production', () => {
      const config = parseEnv({
        DATABASE_URL: VALID_URL,
        NODE_ENV: 'production',
        JWT_SECRET: PROD_VALID_SECRET,
      });

      expect(config.NODE_ENV).toBe('production');
      expect(config.JWT_SECRET).toBe(PROD_VALID_SECRET);
    });

    it('applies development default JWT_SECRET in development/test when omitted', () => {
      const devConfig = parseEnv({
        DATABASE_URL: VALID_URL,
        NODE_ENV: 'development',
      });
      expect(devConfig.JWT_SECRET).toBe('udyam-pay-dev-super-secret-jwt-key-min-32-chars!');

      const testConfig = parseEnv({
        DATABASE_URL: VALID_URL,
        NODE_ENV: 'test',
      });
      expect(testConfig.JWT_SECRET).toBe('udyam-pay-dev-super-secret-jwt-key-min-32-chars!');
    });

    it('rejects DEV_DEFAULT_WEBHOOK_SECRET in production', () => {
      expect(() =>
        parseEnv({
          DATABASE_URL: VALID_URL,
          NODE_ENV: 'production',
          JWT_SECRET: PROD_VALID_SECRET,
          DEV_DEFAULT_WEBHOOK_SECRET: 'some-dev-secret',
        }),
      ).toThrow(EnvValidationError);
    });
  });

  describe('PROVIDER_MODE configuration requirements', () => {
    const PROD_VALID_SECRET = 'this-is-a-valid-production-secret-min-32-chars-long!';

    it('defaults to mock in development and test when omitted', () => {
      const devConfig = parseEnv({ DATABASE_URL: VALID_URL, NODE_ENV: 'development' });
      expect(devConfig.PROVIDER_MODE).toBe('mock');

      const testConfig = parseEnv({ DATABASE_URL: VALID_URL, NODE_ENV: 'test' });
      expect(testConfig.PROVIDER_MODE).toBe('mock');
    });

    it('defaults to production in production when omitted', () => {
      const prodConfig = parseEnv({
        DATABASE_URL: VALID_URL,
        NODE_ENV: 'production',
        JWT_SECRET: PROD_VALID_SECRET,
      });
      expect(prodConfig.PROVIDER_MODE).toBe('production');
    });

    it('strictly rejects PROVIDER_MODE=mock in production to prevent silent mock fallback', () => {
      expect(() =>
        parseEnv({
          DATABASE_URL: VALID_URL,
          NODE_ENV: 'production',
          JWT_SECRET: PROD_VALID_SECRET,
          PROVIDER_MODE: 'mock',
        }),
      ).toThrow(EnvValidationError);
    });

    it('accepts PROVIDER_MODE=sandbox or PROVIDER_MODE=production', () => {
      const sandboxConfig = parseEnv({
        DATABASE_URL: VALID_URL,
        NODE_ENV: 'development',
        PROVIDER_MODE: 'sandbox',
      });
      expect(sandboxConfig.PROVIDER_MODE).toBe('sandbox');

      const prodConfig = parseEnv({
        DATABASE_URL: VALID_URL,
        NODE_ENV: 'production',
        JWT_SECRET: PROD_VALID_SECRET,
        PROVIDER_MODE: 'production',
      });
      expect(prodConfig.PROVIDER_MODE).toBe('production');
    });
  });
});
