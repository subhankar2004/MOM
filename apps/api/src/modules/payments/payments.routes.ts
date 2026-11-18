import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { getOrderForUser } from '../orders/orders.service.js';
import { orderSchema } from '../orders/orders.routes.js';
import type { PaymentGateway } from './gateway.js';
import { confirmPayment, refundOrder, startPayment } from './payments.service.js';
import { verifyCheckoutSignature } from './signatures.js';

export interface PaymentsRoutesOptions {
  gateway: PaymentGateway;
  keySecret: string;
  now?: () => Date;
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
          }),
        },
      },
    },
    async (req) => startPayment(app.db, opts.gateway, req.body.orderId, req.auth!.userId, now()),
  );

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
      }
      return { order: await getOrderForUser(app.db, mine.id, req.auth!.userId) };
    },
  );
};
