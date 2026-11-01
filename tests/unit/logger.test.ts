import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { buildLoggerOptions } from '../../src/config/logger';

function captureLogger(): { logger: pino.Logger; output: () => string } {
  const lines: string[] = [];
  const stream = {
    write: (chunk: string) => {
      lines.push(chunk);
    },
  };
  const logger = pino(
    buildLoggerOptions({ NODE_ENV: 'test', LOG_LEVEL: 'info', LOG_PRETTY: false }),
    stream,
  );
  return { logger, output: () => lines.join('') };
}

describe('logger redaction', () => {
  it('redacts credentials and personal data at several nesting levels', () => {
    const { logger, output } = captureLogger();

    logger.info(
      {
        password: 'hunter2',
        user: { email: 'owner@shop.example', refreshToken: 'rt-abc123' },
        customer: { fullName: 'Asha Verma', phone: '+919999999999' },
        req: { headers: { authorization: 'Bearer top-secret-token', cookie: 'sid=abc' } },
        nested: { deeper: { otp: '123456' } },
      },
      'sensitive log',
    );

    const written = output();
    for (const secret of [
      'hunter2',
      'owner@shop.example',
      'rt-abc123',
      'Asha Verma',
      '+919999999999',
      'top-secret-token',
      'sid=abc',
      '123456',
    ]) {
      expect(written).not.toContain(secret);
    }
    expect(written).toContain('[REDACTED]');
    expect(written).toContain('sensitive log');
  });

  it('keeps non-sensitive fields', () => {
    const { logger, output } = captureLogger();

    logger.info({ applicationId: 'app-1', status: 'SUBMITTED' }, 'status changed');

    expect(output()).toContain('app-1');
    expect(output()).toContain('SUBMITTED');
  });

  it('only enables the pretty transport outside production', () => {
    expect(
      buildLoggerOptions({ NODE_ENV: 'development', LOG_LEVEL: 'info', LOG_PRETTY: true })
        .transport,
    ).toBeDefined();
    expect(
      buildLoggerOptions({ NODE_ENV: 'production', LOG_LEVEL: 'info', LOG_PRETTY: true }).transport,
    ).toBeUndefined();
  });
});
