import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest } from '../../lib/errors.js';
import { getOrderForUser, placeOrder, type OrderView } from './orders.service.js';
import { pickupQrPayload } from './pickup-qr.js';
import { cancelOrderByStudent } from './cancel.service.js';
import { listOrdersForUser } from './orders-list.service.js';
import { openEventStream } from '../../plugins/sse.js';
import type { EventHub } from '../events/event-hub.js';
import type { PaymentGateway } from '../payments/gateway.js';

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
  /** Signed QR payload to show at the counter, while the order is waiting to be collected. */
  pickupQr: z.string().nullable(),
  note: z.string().nullable(),
  /** Why the stall rejected it (shown to the student). */
  rejectReason: z.string().nullable(),
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

const QR_STATUSES = new Set(['placed', 'preparing', 'ready']);

/** The order as sent to its owner, with the pickup QR when it can be used. */
export function toOrderResponse(order: OrderView, qrSecret: string) {
  return {
    ...order,
    pickupQr: order.tokenNo && QR_STATUSES.has(order.status) ? pickupQrPayload(qrSecret, order.id) : null,
  };
}

/** /v1/orders — a signed-in user's own orders. */
export const ordersRoutes: FastifyPluginAsyncZod<{
  now?: () => Date;
  upiOnline: boolean;
  qrSecret: string;
  events: EventHub;
  gateway: PaymentGateway | null;
}> = async (app, opts) => {
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
        {
          ...req.body,
          userId: req.auth!.userId,
          idempotencyKey: req.headers['idempotency-key'],
          upiOnline: opts.upiOnline,
        },
        now(),
      );
      return reply.status(replayed ? 200 : 201).send({ order: toOrderResponse(order, opts.qrSecret) });
    },
  );

  app.get(
    '/',
    {
      schema: {
        tags: ['orders'],
        summary: 'My orders: active (in progress) or past (paginated, newest first)',
        querystring: z.object({
          scope: z.enum(['active', 'past']).default('active'),
          before: z.uuid('Not a valid order id').optional(),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        }),
        response: {
          200: z.object({
            orders: z.array(
              z.object({
                id: z.uuid(),
                stall: z.object({ slug: z.string(), name: z.string() }),
                status: orderSchema.shape.status,
                paymentMethod: orderSchema.shape.paymentMethod,
                paymentStatus: orderSchema.shape.paymentStatus,
                tokenNo: z.number().int().nullable(),
                totalPaise: z.number().int(),
                itemCount: z.number().int(),
                itemsPreview: z.string(),
                createdAt: z.date(),
              }),
            ),
            nextBefore: z.string().nullable(),
          }),
        },
      },
    },
    async (req) =>
      listOrdersForUser(app.db, req.auth!.userId, req.query.scope, {
        before: req.query.before,
        limit: req.query.limit,
      }),
  );

  // Live updates for all my orders (Server-Sent Events). Resumes with Last-Event-ID.
  app.get(
    '/events',
    {
      config: { rateLimit: false },
      schema: { tags: ['orders'], summary: 'Live order updates (text/event-stream)' },
    },
    async (req, reply) => {
      const lastEventId = req.headers['last-event-id'];
      openEventStream(
        req,
        reply,
        (send) =>
          opts.events.subscribeUser(
            req.auth!.userId,
            send,
            typeof lastEventId === 'string' ? lastEventId : undefined,
          ),
        { onShutdown: (fn) => opts.events.onStop(fn) },
      );
    },
  );

  app.post(
    '/:orderId/cancel',
    {
      schema: {
        tags: ['orders'],
        summary: 'Cancel my order (only before the stall starts preparing; paid UPI orders are refunded)',
        params: z.object({ orderId: z.uuid('Not a valid order id') }),
        response: { 200: z.object({ order: orderSchema }) },
      },
    },
    async (req) => {
      await cancelOrderByStudent(
        app.db,
        opts.gateway,
        { orderId: req.params.orderId, userId: req.auth!.userId, now: now() },
        req.log,
      );
      return {
        order: toOrderResponse(
          await getOrderForUser(app.db, req.params.orderId, req.auth!.userId),
          opts.qrSecret,
        ),
      };
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
    async (req) => ({
      order: toOrderResponse(
        await getOrderForUser(app.db, req.params.orderId, req.auth!.userId),
        opts.qrSecret,
      ),
    }),
  );
};
