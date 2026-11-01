import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ALLOWED_ORIGIN, buildTestApp } from '../helpers/build-test-app';

describe('health endpoints', () => {
  it('GET /health returns 200 with a request id and security headers', async () => {
    const res = await request(buildTestApp()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('GET /ready returns 200 when dependencies are reachable', async () => {
    const res = await request(buildTestApp()).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('GET /ready returns 503 without leaking details when a dependency fails', async () => {
    const app = buildTestApp({
      readinessCheck: () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432')),
    });
    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });

  it('GET /ready returns 503 when the dependency check hangs', async () => {
    const app = buildTestApp({
      readinessCheck: () => new Promise<void>(() => undefined),
      readinessTimeoutMs: 50,
    });
    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
  });
});

describe('request ids', () => {
  it('echoes a well-formed inbound X-Request-Id', async () => {
    const res = await request(buildTestApp())
      .get('/health')
      .set('X-Request-Id', 'client-req-12345');

    expect(res.headers['x-request-id']).toBe('client-req-12345');
  });

  it('replaces a malformed inbound X-Request-Id', async () => {
    const res = await request(buildTestApp()).get('/health').set('X-Request-Id', 'bad id!');

    expect(res.headers['x-request-id']).not.toBe('bad id!');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('error handling', () => {
  it('returns the standard envelope for unknown routes', async () => {
    const res = await request(buildTestApp()).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('returns 400 INVALID_JSON for malformed JSON bodies', async () => {
    const res = await request(buildTestApp())
      .post('/api/v1/echo')
      .set('Content-Type', 'application/json')
      .send('{"amountPaise":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 413 PAYLOAD_TOO_LARGE when the body exceeds the limit', async () => {
    const app = buildTestApp({ env: { REQUEST_BODY_LIMIT: '1kb' } });
    const res = await request(app)
      .post('/api/v1/echo')
      .send({ data: 'x'.repeat(5000) });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 400 VALIDATION_ERROR with field details for Zod failures', async () => {
    const res = await request(buildTestApp()).post('/api/v1/validate').send({ amountPaise: -5 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('amountPaise');
  });

  it('hides internal error messages behind a generic 500', async () => {
    const res = await request(buildTestApp()).get('/api/v1/boom');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret-internal-detail');
  });

  it('forwards rejections from async handlers to the error handler', async () => {
    const res = await request(buildTestApp()).get('/api/v1/async-boom');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret-async-detail');
  });
});

describe('CORS', () => {
  it('allows configured origins', async () => {
    const res = await request(buildTestApp()).get('/health').set('Origin', ALLOWED_ORIGIN);

    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  it('does not grant access to unknown origins', async () => {
    const res = await request(buildTestApp()).get('/health').set('Origin', 'https://evil.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers preflight requests for allowed origins', async () => {
    const res = await request(buildTestApp())
      .options('/api/v1/echo')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });
});

describe('rate limiting', () => {
  it('returns 429 in the standard envelope once the limit is exceeded', async () => {
    const app = buildTestApp({ env: { RATE_LIMIT_MAX: '2' } });

    expect((await request(app).get('/api/v1/ping')).status).toBe(200);
    expect((await request(app).get('/api/v1/ping')).status).toBe(200);
    const limited = await request(app).get('/api/v1/ping');

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('never rate-limits health probes', async () => {
    const app = buildTestApp({ env: { RATE_LIMIT_MAX: '1' } });

    for (let i = 0; i < 5; i += 1) {
      expect((await request(app).get('/health')).status).toBe(200);
    }
  });
});
