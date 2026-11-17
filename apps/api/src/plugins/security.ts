import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { apiDocsEnabled, type Env } from '../config/env.js';

export async function registerSecurity(
  app: FastifyInstance,
  env: Pick<Env, 'WEB_ORIGIN' | 'RATE_LIMIT_PER_MINUTE' | 'NODE_ENV' | 'API_DOCS'>,
): Promise<void> {
  // Security headers. The strict Content-Security-Policy is relaxed only while the
  // Swagger UI (inline scripts/styles) is served — never in production.
  await app.register(helmet, {
    contentSecurityPolicy: apiDocsEnabled(env) ? false : undefined,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  // Only our web app may call the API from a browser. Credentials = cookies (auth, #7).
  await app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });

  // Per-IP budget for every route. Health checks opt out; OTP/payment routes add stricter limits later.
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  });
}
