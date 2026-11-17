import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { apiDocsEnabled, type Env } from './config/env.js';
import type { Db } from './db/client.js';
import { registerDocs } from './plugins/docs.js';
import { registerErrorHandling } from './plugins/error-handler.js';
import { registerSecurity } from './plugins/security.js';
import { healthRoutes } from './routes/health.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Drizzle database (or, in tests, a transaction that is rolled back). */
    db: Db;
    env: Env;
  }
}

export interface BuildAppOptions {
  env: Env;
  db: Db;
  /** Override the logger (tests pass `false`). Defaults to pino configured from env. */
  logger?: FastifyServerOptions['logger'];
}

/** Accepts an incoming X-Request-Id only if it looks like an id (prevents log injection). */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function loggerOptions(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>): FastifyServerOptions['logger'] {
  return {
    level: env.LOG_LEVEL,
    // Never write credentials to the logs.
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[redacted]',
    },
    ...(env.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  };
}

/**
 * Builds the API without starting it, so tests can call `app.inject()`.
 * server.ts adds the listening socket and graceful shutdown.
 */
export async function buildApp({ env, db, logger }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ?? loggerOptions(env),
    // Behind the AWS load balancer the real client IP is in X-Forwarded-For (needed for rate limits).
    trustProxy:
      env.TRUST_PROXY_HOPS > 0 ? (_address: string, hop: number) => hop < env.TRUST_PROXY_HOPS : false,
    bodyLimit: 100 * 1024,
    // false = always go through genReqId, which validates any incoming X-Request-Id first.
    requestIdHeader: false,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
    logController: new LogController({
      requestIdLogLabel: 'requestId',
      // The load balancer polls these every few seconds; logging them would drown real traffic.
      disableRequestLogging: (req) => req.url === '/health' || req.url === '/ready',
    }),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('db', db);
  app.decorate('env', env);

  // Every response carries the request id, so a user's error report can be matched to the logs.
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  registerErrorHandling(app);
  await registerSecurity(app, env);
  if (apiDocsEnabled(env)) await registerDocs(app, env.APP_VERSION);

  await app.register(healthRoutes, {
    version: env.APP_VERSION,
    pingDatabase: async () => {
      await db.execute(sql`select 1`);
    },
  });

  // Versioned business API. Feature routes are registered here from issue #7 onwards.
  await app.register(async (_v1) => {}, { prefix: '/v1' });

  return app;
}
