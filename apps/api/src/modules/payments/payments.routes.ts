import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { payments } from '../../db/schema/index.js';
import { AppError } from '../../lib/errors.js';
import { getOrderForUser } from '../orders/orders.service.js';
import { orderSchema, toOrderResponse } from '../orders/orders.routes.js';
import type { PaymentGateway } from './gateway.js';
import { confirmPayment, refundOrder, startPayment } from './payments.service.js';
import { ensureTransfer } from '../finance/transfers.service.js';
import { verifyCheckoutSignature } from './signatures.js';

export interface PaymentsRoutesOptions {
  gateway: PaymentGateway;
  keySecret: string;
  qrSecret: string;
  now?: () => Date;
  /** PAYMENTS_PROVIDER=test: "paying" completes at once (local manual testing only). */
  instantTestPayments?: boolean;
}

/** /v1/payments/razorpay/... — paying for one's own UPI order (signed in). */
export const paymentsRoutes: FastifyPluginAsyncZod<PaymentsRoutesOptions> = async (app, opts) => {
  const now = opts.now ?? (() => new Date());
  app.addHook('preHandler', app.requireAuth);
  const perUser = {
    max: 30,
    timeWindow: '1 minute',
    hook: 'preHandler' as const,
    keyGenerator: (req: { auth: { userId: string } | null; ip: string }) =>
      req.auth ? `user:${req.auth.userId}` : `ip:${req.ip}`,
  };

  app.post(
    '/razorpay/order',
    {
      config: { rateLimit: perUser },
      schema: {
        tags: ['payments'],
        summary: 'Start paying for my UPI order (returns what Razorpay Checkout needs)',
        body: z.object({ orderId: z.uuid('Not a valid order id') }),
        response: {
          200: z.object({
            keyId: z.string(),
            razorpayOrderId: z.string(),
            amountPaise: z.number().int(),
            currency: z.literal('INR'),
            orderId: z.uuid(),
            expiresAt: z.date().nullable(),
            prefill: z.object({ contact: z.string().optional(), name: z.string().optional() }),
            /** Test payment mode (PAYMENTS_PROVIDER=test): skip Razorpay and use /test/complete. */
            testMode: z.boolean(),
          }),
        },
      },
    },
    async (req) => ({
      ...(await startPayment(app.db, opts.gateway, req.body.orderId, req.auth!.userId, now())),
      testMode: opts.instantTestPayments ?? false,
    }),
  );

  // Test payment mode only (PAYMENTS_PROVIDER=test, which env validation refuses on staging and
  // production, and which always uses the offline gateway): "paying" completes at once, with no
  // Razorpay window and no real money.
  if (opts.instantTestPayments && opts.gateway.name === 'fake') {
    app.post(
      '/test/complete',
      {
        config: { rateLimit: perUser },
        schema: {
          tags: ['payments'],
          summary: 'PAYMENTS_PROVIDER=test only: mark my UPI order paid (no Razorpay, no money)',
          body: z.object({
            orderId: z.uuid('Not a valid order id'),
            razorpayOrderId: z.string().min(1).max(64),
          }),
          response: { 200: z.object({ order: orderSchema }) },
        },
      },
      async (req) => {
        const mine = await getOrderForUser(app.db, req.body.orderId, req.auth!.userId);
        const [attempt] = await app.db
          .select({ orderId: payments.orderId })
          .from(payments)
          .where(eq(payments.providerOrderId, req.body.razorpayOrderId));
        if (attempt?.orderId !== mine.id)
          throw new AppError(400, 'BAD_REQUEST', 'Payment does not belong to this order');
        const result = await confirmPayment(
          app.db,
          {
            razorpayOrderId: req.body.razorpayOrderId,
            razorpayPaymentId: `pay_test${randomBytes(7).toString('hex')}`,
          },
          now(),
        );
        if (result.outcome === 'late') {
          await refundOrder(
            app.db,
            opts.gateway,
            { orderId: mine.id, reason: 'Paid after the order expired', actorId: null },
            req.log,
          );
        } else {
          await ensureTransfer(app.db, opts.gateway, mine.id, req.log);
        }
        req.log.info({ orderId: mine.id }, 'test payment completed (no real money)');
        return {
          order: toOrderResponse(await getOrderForUser(app.db, mine.id, req.auth!.userId), opts.qrSecret),
        };
      },
    );
  }

  app.post(
    '/razorpay/verify',
    {
      config: { rateLimit: perUser },
      schema: {
        tags: ['payments'],
        summary: 'Confirm a Razorpay payment (signature checked on the server) → token issued',
        body: z.object({
          orderId: z.uuid('Not a valid order id'),
          razorpayOrderId: z.string().min(1).max(64),
          razorpayPaymentId: z.string().min(1).max(64),
          razorpaySignature: z.string().min(1).max(256),
        }),
        response: { 200: z.object({ order: orderSchema }) },
      },
    },
    async (req) => {
      const b = req.body;
      // The browser can't fake this: only Razorpay (and we) know the key secret.
      if (
        !verifyCheckoutSignature(opts.keySecret, b.razorpayOrderId, b.razorpayPaymentId, b.razorpaySignature)
      ) {
        req.log.warn({ orderId: b.orderId }, 'invalid Razorpay checkout signature');
        throw new AppError(400, 'BAD_REQUEST', 'Payment could not be verified');
      }
      // The Razorpay order must belong to this user's order (checked before touching anything).
      const mine = await getOrderForUser(app.db, b.orderId, req.auth!.userId);
      const result = await confirmPayment(
        app.db,
        { razorpayOrderId: b.razorpayOrderId, razorpayPaymentId: b.razorpayPaymentId },
        now(),
      );
      if (result.orderId !== mine.id)
        throw new AppError(400, 'BAD_REQUEST', 'Payment does not belong to this order');
      if (result.outcome === 'late') {
        await refundOrder(
          app.db,
          opts.gateway,
          { orderId: mine.id, reason: 'Paid after the order expired', actorId: null },
          req.log,
        );
      } else {
        // The stall's share, held until pickup (retried by the job if Razorpay is down).
        await ensureTransfer(app.db, opts.gateway, mine.id, req.log);
      }
      return {
        order: toOrderResponse(await getOrderForUser(app.db, mine.id, req.auth!.userId), opts.qrSecret),
      };
    },
  );
};
