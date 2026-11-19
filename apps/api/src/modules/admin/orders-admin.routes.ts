import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireSuperAdmin } from '../../plugins/authz.js';
import type { OrdersAdminService } from './orders-admin.service.js';

const orderStatus = z.enum([
  'pending_payment',
  'placed',
  'preparing',
  'ready',
  'collected',
  'rejected',
  'cancelled',
  'expired',
]);
const paymentStatus = z.enum(['pending', 'paid', 'due', 'paid_cash', 'refund_pending', 'refunded', 'failed']);
const paymentMethod = z.enum(['upi', 'cash']);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const orderParams = z.object({ orderId: z.uuid('Not a valid order id') });
const reason = z
  .string()
  .trim()
  .min(3, 'Give a reason (at least 3 characters)')
  .max(200, 'Keep the reason under 200 characters');

const orderDetail = z.object({
  order: z.object({
    id: z.uuid(),
    status: orderStatus,
    paymentMethod,
    paymentStatus,
    tokenNo: z.number().int().nullable(),
    tokenDay: z.string().nullable(),
    note: z.string().nullable(),
    reason: z.string().nullable(),
    subtotalPaise: z.number().int(),
    platformFeePaise: z.number().int(),
    cashFeePaise: z.number().int(),
    totalPaise: z.number().int(),
    createdAt: z.date(),
    placedAt: z.date().nullable(),
    acceptedAt: z.date().nullable(),
    readyAt: z.date().nullable(),
    collectedAt: z.date().nullable(),
    closedAt: z.date().nullable(),
  }),
  stall: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
  student: z.object({ id: z.uuid(), name: z.string().nullable(), phone: z.string().nullable() }),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().int(),
      unitPricePaise: z.number().int(),
      lineTotalPaise: z.number().int(),
    }),
  ),
  payments: z.array(
    z.object({
      id: z.uuid(),
      providerPaymentId: z.string().nullable(),
      amountPaise: z.number().int(),
      status: z.string(),
      createdAt: z.date(),
    }),
  ),
  refunds: z.array(
    z.object({
      id: z.uuid(),
      amountPaise: z.number().int(),
      status: z.string(),
      reason: z.string(),
      createdAt: z.date(),
    }),
  ),
  timeline: z.array(z.object({ at: z.date(), label: z.string(), by: z.string().nullable() })),
  payout: z
    .object({
      status: z.enum(['created', 'on_hold', 'released', 'reversed', 'failed']),
      amountPaise: z.number().int(),
      providerTransferId: z.string().nullable(),
      lastError: z.string().nullable(),
      releasedAt: z.date().nullable(),
    })
    .nullable(),
  can: z.object({ cancel: z.boolean(), refund: z.boolean() }),
});

/** /v1/admin/orders — the orders explorer (spec §6.3 A5). Super admin only; actions audited. */
export const adminOrdersRoutes: FastifyPluginAsyncZod<{
  orders: OrdersAdminService;
  now?: () => Date;
}> = async (app, opts) => {
  const { orders } = opts;
  const now = opts.now ?? (() => new Date());
  app.addHook('preHandler', app.requireAuth);
  app.addHook('preHandler', requireSuperAdmin(app.db));
  const actor = (req: {
    auth: { userId: string } | null;
    ip: string;
    headers: { 'user-agent'?: string };
  }) => ({
    actorId: req.auth!.userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  app.get(
    '/orders',
    {
      schema: {
        tags: ['admin'],
        summary:
          'Every order: search by order id, #token, phone or name; filter by stall, status, payment, dates',
        querystring: z.object({
          q: z.string().max(60).optional(),
          stallId: z.uuid().optional(),
          status: orderStatus.optional(),
          paymentMethod: paymentMethod.optional(),
          paymentStatus: paymentStatus.optional(),
          from: date.optional(),
          to: date.optional(),
          before: z.uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: {
          200: z.object({
            orders: z.array(
              z.object({
                id: z.uuid(),
                createdAt: z.date(),
                stall: z.object({ id: z.uuid(), name: z.string() }),
                student: z.object({
                  id: z.uuid(),
                  name: z.string().nullable(),
                  phone: z.string().nullable(),
                }),
                tokenNo: z.number().int().nullable(),
                status: orderStatus,
                paymentMethod,
                paymentStatus,
                totalPaise: z.number().int(),
              }),
            ),
            nextBefore: z.string().nullable(),
          }),
        },
      },
    },
    async (req) => orders.list(req.query),
  );

  app.get(
    '/orders/:orderId',
    {
      schema: {
        tags: ['admin'],
        summary: 'One order with its items, payments, refunds and timeline',
        params: orderParams,
        response: { 200: orderDetail },
      },
    },
    async (req) => orders.get(req.params.orderId),
  );

  app.post(
    '/orders/:orderId/cancel',
    {
      schema: {
        tags: ['admin'],
        summary: 'Cancel an order with a reason (paid UPI orders are refunded in full)',
        params: orderParams,
        body: z.object({ reason }),
        response: { 200: orderDetail.extend({ refund: z.enum(['started', 'retry_later', 'none']) }) },
      },
    },
    async (req) => orders.cancel(req.params.orderId, req.body.reason, actor(req), now(), req.log),
  );

  app.post(
    '/orders/:orderId/refund',
    {
      schema: {
        tags: ['admin'],
        summary: "Refund a finished UPI order in full, or retry a refund that couldn't start",
        params: orderParams,
        body: z.object({ reason }),
        response: { 200: orderDetail },
      },
    },
    async (req) => orders.refund(req.params.orderId, req.body.reason, actor(req), req.log),
  );
};
