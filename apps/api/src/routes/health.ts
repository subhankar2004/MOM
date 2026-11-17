import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export interface HealthOptions {
  version: string;
  /** Resolves if the database answers; rejects otherwise. */
  pingDatabase: () => Promise<void>;
  /** How long /ready waits for the database before reporting it as down. */
  readyTimeoutMs?: number;
}

const healthResponse = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptimeSeconds: z.number().int(),
});

const readyResponse = z.object({
  status: z.enum(['ready', 'unavailable']),
  checks: z.object({ database: z.enum(['ok', 'error']) }),
});

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * GET /health — liveness: the process is up (used to restart a stuck container).
 * GET /ready  — readiness: the API can serve traffic, i.e. the database answers
 *               (the load balancer only sends requests to ready tasks).
 */
export const healthRoutes: FastifyPluginAsyncZod<HealthOptions> = async (app, opts) => {
  const ops = { rateLimit: false } as const;

  app.get(
    '/health',
    {
      config: ops,
      schema: { tags: ['ops'], summary: 'Liveness check', response: { 200: healthResponse } },
    },
    async () => ({
      status: 'ok' as const,
      version: opts.version,
      uptimeSeconds: Math.floor(process.uptime()),
    }),
  );

  app.get(
    '/ready',
    {
      config: ops,
      schema: {
        tags: ['ops'],
        summary: 'Readiness check (database)',
        response: { 200: readyResponse, 503: readyResponse },
      },
    },
    async (request, reply) => {
      try {
        await withTimeout(opts.pingDatabase(), opts.readyTimeoutMs ?? 2000);
        return { status: 'ready' as const, checks: { database: 'ok' as const } };
      } catch (err) {
        request.log.warn({ err }, 'readiness check failed: database unreachable');
        return reply.status(503).send({ status: 'unavailable', checks: { database: 'error' } });
      }
    },
  );
};
