import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from './app.js';
import { createDb, type Db } from './db/client.js';
import { AppError, conflict } from './lib/errors.js';
import { testEnv } from './test/test-app.js';

/** Unit tests: the API without a database (a stub stands in for Drizzle). */
const okDb = { execute: async () => ({ rows: [] }) } as unknown as Db;

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(overrides: Record<string, string> = {}, db: Db = okDb, extraRoutes = true) {
  app = await buildApp({ env: testEnv(overrides), db, logger: false });
  if (extraRoutes) {
    const v1 = app.withTypeProvider<ZodTypeProvider>();
    v1.post(
      '/v1/test/echo',
      { schema: { body: z.object({ name: z.string().min(2), qty: z.number().int().positive() }) } },
      async (req) => req.body,
    );
    v1.get('/v1/test/conflict', async () => {
      throw conflict('That slug is taken', { field: 'slug' });
    });
    v1.get('/v1/test/crash', async () => {
      throw new Error('database password is hunter2');
    });
    v1.get('/v1/test/teapot', async () => {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Payments are down');
    });
  }
  await app.ready();
  return app;
}

describe('GET /health', () => {
  it('reports liveness and version, without rate-limit headers', async () => {
    const res = await (await start({ APP_VERSION: 'abc123' })).inject('/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', version: 'abc123', uptimeSeconds: expect.any(Number) });
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
  });
});

describe('GET /ready', () => {
  it('is ready when the database answers', async () => {
    const res = await (await start()).inject('/ready');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', checks: { database: 'ok' } });
  });

  it('returns 503 when the database is unreachable', async () => {
    // Nothing listens on port 1 → connection refused.
    const { db, pool } = createDb('postgres://mom:mom@127.0.0.1:1/mom_test', { max: 1 });
    try {
      const res = await (await start({}, db)).inject('/ready');
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ status: 'unavailable', checks: { database: 'error' } });
    } finally {
      await pool.end();
    }
  });

  it('returns 503 when the database hangs (2 s timeout)', async () => {
    const hangingDb = { execute: () => new Promise(() => {}) } as unknown as Db;
    const res = await (await start({}, hangingDb)).inject('/ready');
    expect(res.statusCode).toBe(503);
  });
});

describe('error format (spec §9)', () => {
  it('404 for unknown routes, with the request id in body and header', async () => {
    const res = await (await start()).inject('/v1/does-not-exist');
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /v1/does-not-exist not found' },
      requestId: expect.any(String),
    });
    expect(res.headers['x-request-id']).toBe(body.requestId);
  });

  it('400 VALIDATION_ERROR lists the bad fields without echoing values', async () => {
    const res = await (
      await start()
    ).inject({
      method: 'POST',
      url: '/v1/test/echo',
      payload: { name: 'x', qty: -2, secret: 'should-not-appear' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.map((d: { field: string }) => d.field).sort()).toEqual([
      'body.name',
      'body.qty',
    ]);
    expect(res.body).not.toContain('should-not-appear');
  });

  it('passes valid input through', async () => {
    const res = await (
      await start()
    ).inject({
      method: 'POST',
      url: '/v1/test/echo',
      payload: { name: 'Dosa', qty: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: 'Dosa', qty: 2 });
  });

  it('AppError keeps its status, code, message and details', async () => {
    const a = await start();
    const res = await a.inject('/v1/test/conflict');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({
      code: 'CONFLICT',
      message: 'That slug is taken',
      details: { field: 'slug' },
    });
    expect((await a.inject('/v1/test/teapot')).json().error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('unexpected errors become a generic 500 that leaks nothing', async () => {
    const res = await (await start()).inject('/v1/test/crash');
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toEqual({ code: 'INTERNAL_ERROR', message: 'Something went wrong' });
    expect(res.body).not.toContain('hunter2');
  });

  it('malformed JSON → 400, wrong content type → 415, oversized body → 413', async () => {
    const a = await start();
    const bad = await a.inject({
      method: 'POST',
      url: '/v1/test/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"name":',
    });
    expect([bad.statusCode, bad.json().error.code]).toEqual([400, 'BAD_REQUEST']);

    const xml = await a.inject({
      method: 'POST',
      url: '/v1/test/echo',
      headers: { 'content-type': 'application/xml' },
      payload: '<x/>',
    });
    expect([xml.statusCode, xml.json().error.code]).toEqual([415, 'UNSUPPORTED_MEDIA_TYPE']);

    const big = await a.inject({
      method: 'POST',
      url: '/v1/test/echo',
      payload: { name: 'x'.repeat(200 * 1024), qty: 1 },
    });
    expect([big.statusCode, big.json().error.code]).toEqual([413, 'PAYLOAD_TOO_LARGE']);
  });
});

describe('request ids', () => {
  it('echoes a safe incoming X-Request-Id', async () => {
    const res = await (
      await start()
    ).inject({ url: '/health', headers: { 'x-request-id': 'trace-12345678' } });
    expect(res.headers['x-request-id']).toBe('trace-12345678');
  });

  it.each(['<script>alert(1)</script>', 'short', 'x'.repeat(65), 'line\nbreak-1234'])(
    'replaces an unsafe incoming id %j with a fresh UUID',
    async (incoming) => {
      const res = await (await start()).inject({ url: '/health', headers: { 'x-request-id': incoming } });
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    },
  );
});

describe('security', () => {
  it('sets security headers', async () => {
    const res = await (await start()).inject('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toContain('max-age=');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS only from the configured web origin, with credentials', async () => {
    const a = await start({ WEB_ORIGIN: 'https://mom.example' });
    const preflight = (origin: string) =>
      a.inject({
        method: 'OPTIONS',
        url: '/v1/test/echo',
        headers: { origin, 'access-control-request-method': 'POST' },
      });
    const ok = await preflight('https://mom.example');
    expect(ok.headers['access-control-allow-origin']).toBe('https://mom.example');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const evil = await preflight('https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate-limits per IP with 429 RATE_LIMITED, but never the health checks', async () => {
    const a = await start({ RATE_LIMIT_PER_MINUTE: '10' });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await a.inject('/v1/test/conflict')).statusCode);
    expect(statuses.slice(0, 10).every((s) => s === 409)).toBe(true);
    const limited = await a.inject('/v1/test/conflict');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
    for (let i = 0; i < 15; i++) expect((await a.inject('/health')).statusCode).toBe(200);
  });
});

describe('API docs', () => {
  it('serves OpenAPI JSON outside production', async () => {
    const res = await (await start({}, okDb, false)).inject('/docs/json');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ openapi: '3.1.0', paths: { '/health': {}, '/ready': {} } });
  });

  it('is not served in production', async () => {
    const res = await (
      await start(
        {
          NODE_ENV: 'production',
          SMS_PROVIDER: 'aws',
          AWS_SMS_ORIGINATION_IDENTITY: 'MOMVST',
          AWS_SMS_DLT_ENTITY_ID: '1',
          AWS_SMS_DLT_TEMPLATE_ID: '2',
        },
        okDb,
        false,
      )
    ).inject('/docs/json');
    expect(res.statusCode).toBe(404);
  });
});
