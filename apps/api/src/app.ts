import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import { sql } from 'drizzle-orm';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { apiDocsEnabled, cookiesSecure, upiConfigured, type Env } from './config/env.js';
import type { Db } from './db/client.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { AuthService } from './modules/auth/auth.service.js';
import { adminAccessRoutes } from './modules/admin/members.routes.js';
import { meRoutes } from './modules/auth/me.routes.js';
import { cartRoutes } from './modules/cart/cart.routes.js';
import { ordersRoutes } from './modules/orders/orders.routes.js';
import { createPaymentGateway, type PaymentGateway } from './modules/payments/gateway.js';
import { paymentsRoutes } from './modules/payments/payments.routes.js';
import { razorpayWebhookRoutes } from './modules/payments/webhooks.routes.js';
import { EventHub } from './modules/events/event-hub.js';
import { stallsRoutes } from './modules/stalls/stalls.routes.js';
import { StallsService } from './modules/stalls/stalls.service.js';
import { vendorRoutes } from './modules/vendor/vendor.routes.js';
import { registerAuth } from './plugins/auth.js';
import { registerDocs } from './plugins/docs.js';
import { registerErrorHandling } from './plugins/error-handler.js';
import { registerSecurity } from './plugins/security.js';
import { healthRoutes } from './routes/health.js';
import { createSmsProvider, type SmsProvider } from './sms/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Drizzle database (or, in tests, a transaction that is rolled back). */
    db: Db;
    /** Payment gateway (Razorpay), or null when UPI isn't configured. */
    paymentGateway: PaymentGateway | null;
    /** Live order updates (Postgres LISTEN/NOTIFY → SSE). */
    events: EventHub;
    env: Env;
  }
}

export interface BuildAppOptions {
  env: Env;
  db: Db;
  /** Override the logger (tests pass `false`). Defaults to pino configured from env. */
  logger?: FastifyServerOptions['logger'];
  /** Override the SMS provider (tests capture messages). Defaults to SMS_PROVIDER. */
  sms?: SmsProvider;
  /** Override the clock (tests). */
  now?: () => Date;
  /** Public stall list cache in ms (spec §10: 15 s). Tests pass 0. */
  stallsCacheTtlMs?: number;
  /** Override the payment gateway (tests). Defaults to Razorpay from env, or none. */
  gateway?: PaymentGateway | null;
  /** Live updates hub. server.ts connects it to Postgres; tests can publish directly. */
  events?: EventHub;
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
export async function buildApp({
  env,
  db,
  logger,
  sms,
  now,
  stallsCacheTtlMs,
  gateway: gatewayOverride,
  events: eventsOverride,
}: BuildAppOptions): Promise<FastifyInstance> {
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
  await app.register(cookie);
  registerAuth(app, { jwtSecret: env.JWT_SECRET, allowedOrigins: env.WEB_ORIGIN });
  if (apiDocsEnabled(env)) await registerDocs(app, env.APP_VERSION);

  await app.register(healthRoutes, {
    version: env.APP_VERSION,
    pingDatabase: async () => {
      await db.execute(sql`select 1`);
    },
  });

  const authService = new AuthService(
    db,
    sms ?? createSmsProvider(env, app.log),
    {
      jwtSecret: env.JWT_SECRET,
      otpPepper: env.OTP_PEPPER,
      testPhones: env.SMS_TEST_PHONES,
      testCode: env.SMS_TEST_CODE,
      superAdminPhones: env.SUPER_ADMIN_PHONES,
    },
    app.log,
  );
  const cookieConfig = { secure: cookiesSecure(env), domain: env.COOKIE_DOMAIN };
  const gateway = gatewayOverride === undefined ? createPaymentGateway(env) : gatewayOverride;
  const upiOnline = gateway !== null && upiConfigured(env);
  app.decorate('paymentGateway', gateway);
  const events = eventsOverride ?? new EventHub(app.log);
  app.decorate('events', events);
  // preClose: end live streams before the server waits for connections to finish.
  app.addHook('preClose', async () => {
    await events.stop();
  });

  // Versioned business API.
  await app.register(
    async (v1) => {
      await v1.register(authRoutes, {
        prefix: '/auth',
        auth: authService,
        cookies: cookieConfig,
        ratePerMinute: env.AUTH_RATE_LIMIT_PER_MINUTE,
      });
      await v1.register(meRoutes, { prefix: '/me', auth: authService, cookies: cookieConfig });
      await v1.register(stallsRoutes, {
        prefix: '/stalls',
        stalls: new StallsService(db, {
          publicImageBaseUrl: env.PUBLIC_IMAGE_BASE_URL,
          now,
          cacheTtlMs: stallsCacheTtlMs ?? env.PUBLIC_CACHE_TTL_SECONDS * 1000,
          upiOnline,
        }),
      });
      await v1.register(cartRoutes, { prefix: '/cart', now, upiOnline });
      await v1.register(ordersRoutes, {
        prefix: '/orders',
        now,
        upiOnline,
        qrSecret: env.QR_SECRET,
        events,
        gateway,
      });
      if (gateway && env.RAZORPAY_KEY_SECRET) {
        await v1.register(paymentsRoutes, {
          prefix: '/payments',
          gateway,
          keySecret: env.RAZORPAY_KEY_SECRET,
          qrSecret: env.QR_SECRET,
          now,
        });
        if (env.RAZORPAY_WEBHOOK_SECRET) {
          await v1.register(razorpayWebhookRoutes, {
            prefix: '/webhooks',
            gateway,
            webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
            now,
          });
        }
      }
      await v1.register(vendorRoutes, { prefix: '/vendor' });
      await v1.register(adminAccessRoutes, { prefix: '/admin' });
    },
    { prefix: '/v1' },
  );

  return app;
}
