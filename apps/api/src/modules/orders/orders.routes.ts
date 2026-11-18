import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest } from '../../lib/errors.js';
import { getOrderForUser, placeOrder } from './orders.service.js';

export const orderSchema = z.object({
  id: z.uuid(),
  stall: z.object({ id: z.uuid(), slug: z.string(), name: z.string(), location: z.string().nullable() }),
  status: z.enum([
    'pending_payment',
    'placed',
    'preparing',
    'ready',
    'collected',
    'rejected',
    'cancelled',
    'expired',
  ]),
  paymentMethod: z.enum(['upi', 'cash']),
  paymentStatus: z.enum(['pending', 'paid', 'due', 'paid_cash', 'refund_pending', 'refunded', 'failed']),
  tokenNo: z.number().int().nullable(),
  tokenDay: z.string().nullable(),
  /** Shown only to the order's owner, who says it at the counter (spec §5). */
  pickupCode: z.string(),
  note: z.string().nullable(),
  items: z.array(
    z.object({
      itemId: z.uuid(),
      name: z.string(),
      quantity: z.number().int(),
      unitPricePaise: z.number().int(),
      lineTotalPaise: z.number().int(),
    }),
  ),
  subtotalPaise: z.number().int(),
  platformFeePaise: z.number().int(),
  cashFeePaise: z.number().int(),
  totalPaise: z.number().int(),
  platformFeeBps: z.number().int(),
  cashFeeBps: z.number().int(),
  createdAt: z.date(),
  expiresAt: z.date().nullable(),
});

/** /v1/orders — a signed-in user's own orders. */
export const ordersRoutes: FastifyPluginAsyncZod<{ now?: () => Date }> = async (app, opts) => {
  const now = opts.now ?? (() => new Date());
  app.addHook('preHandler', app.requireAuth);

  app.post(
    '/',
    {
      // Limited per STUDENT, not per IP: on campus Wi-Fi hundreds of students share one public
      // IP, and a per-IP limit would refuse real orders at lunchtime. Runs after sign-in is checked.
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (req) => (req.auth ? `user:${req.auth.userId}` : `ip:${req.ip}`),
        },
      },
      schema: {
        tags: ['orders'],
        summary: 'Place an order (send a unique Idempotency-Key per checkout; retries return the same order)',
        headers: z.object({
          'idempotency-key': z
            .string('Send an Idempotency-Key header')
            .min(8, 'Idempotency-Key must be 8–100 characters')
            .max(100, 'Idempotency-Key must be 8–100 characters'),
        }),
        body: z.object({
          stallId: z.uuid('Not a valid stall id'),
          items: z
            .array(
              z.object({ itemId: z.uuid('Not a valid dish id'), quantity: z.number().int().min(1).max(20) }),
            )
            .min(1, 'Add at least one dish')
            .max(30, 'At most 30 different dishes per order'),
          paymentMethod: z.enum(['upi', 'cash']),
          note: z.string().trim().max(200, 'Keep the note under 200 characters').optional(),
          expectedTotalPaise: z.number().int().positive(),
        }),
        response: { 200: z.object({ order: orderSchema }), 201: z.object({ order: orderSchema }) },
      },
    },
    async (req, reply) => {
      const ids = req.body.items.map((i) => i.itemId);
      if (new Set(ids).size !== ids.length) throw badRequest('Each dish only once');
      const { order, replayed } = await placeOrder(
        app.db,
        { ...req.body, userId: req.auth!.userId, idempotencyKey: req.headers['idempotency-key'] },
        now(),
      );
      return reply.status(replayed ? 200 : 201).send({ order });
    },
  );

  app.get(
    '/:orderId',
    {
      schema: {
        tags: ['orders'],
        summary: 'One of my orders',
        params: z.object({ orderId: z.uuid('Not a valid order id') }),
        response: { 200: z.object({ order: orderSchema }) },
      },
    },
    async (req) => ({ order: await getOrderForUser(app.db, req.params.orderId, req.auth!.userId) }),
  );
};
