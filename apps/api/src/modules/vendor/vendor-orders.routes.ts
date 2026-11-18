import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireRole, requireStallAccess } from '../../plugins/authz.js';
import { openEventStream } from '../../plugins/sse.js';
import type { EventHub } from '../events/event-hub.js';
import type { PaymentGateway } from '../payments/gateway.js';
import { handOver, verifyPickup } from './pickup.service.js';
import {
  boardOrder as getBoardOrder,
  moveOrder,
  stallBoard,
  type BoardAction,
} from './vendor-orders.service.js';

const params = z.object({ stallId: z.uuid('Not a valid stall id') });
const orderParams = params.extend({ orderId: z.uuid('Not a valid order id') });

const statusEnum = z.enum([
  'pending_payment',
  'placed',
  'preparing',
  'ready',
  'collected',
  'rejected',
  'cancelled',
  'expired',
]);

const boardOrder = z.object({
  id: z.uuid(),
  tokenNo: z.number().int(),
  status: statusEnum,
  paymentMethod: z.enum(['upi', 'cash']),
  paymentStatus: z.enum(['pending', 'paid', 'due', 'paid_cash', 'refund_pending', 'refunded', 'failed']),
  totalPaise: z.number().int(),
  note: z.string().nullable(),
  rejectReason: z.string().nullable(),
  items: z.array(z.object({ name: z.string(), quantity: z.number().int() })),
  placedAt: z.date().nullable(),
  acceptedAt: z.date().nullable(),
  readyAt: z.date().nullable(),
  closedAt: z.date().nullable(),
});

export interface VendorOrdersOptions {
  now?: () => Date;
  events: EventHub;
  gateway: PaymentGateway | null;
  /** Verifies pickup QR codes (the same secret that signs them). */
  qrSecret: string;
}

/** /v1/vendor/stalls/:stallId/orders — the live order board (spec §6.2 V1). */
export const vendorOrdersRoutes: FastifyPluginAsyncZod<VendorOrdersOptions> = async (app, opts) => {
  const now = opts.now ?? (() => new Date());
  app.addHook('preHandler', app.requireAuth);
  app.addHook('preHandler', requireRole('vendor_owner', 'vendor_staff', 'super_admin'));
  const stallAccess = requireStallAccess(app.db);

  app.get(
    '/stalls/:stallId/orders',
    {
      preHandler: stallAccess,
      schema: {
        tags: ['vendor'],
        summary: "The stall's board: orders to accept, cook and hand over, and today's finished ones",
        params,
        response: { 200: z.object({ active: z.array(boardOrder), finishedToday: z.array(boardOrder) }) },
      },
    },
    async (req) => stallBoard(app.db, req.params.stallId, now()),
  );

  app.get(
    '/stalls/:stallId/orders/events',
    {
      preHandler: stallAccess,
      config: { rateLimit: false },
      schema: {
        tags: ['vendor'],
        summary: "Live changes to the stall's orders (text/event-stream, resumes with Last-Event-ID)",
        params,
      },
    },
    async (req, reply) => {
      const lastEventId = req.headers['last-event-id'];
      openEventStream(
        req,
        reply,
        (send) =>
          opts.events.subscribeStall(
            req.params.stallId,
            // The stall needs the order, not who the student is.
            ({ userId: _userId, ...event }) => send(event),
            typeof lastEventId === 'string' ? lastEventId : undefined,
          ),
        { onShutdown: (fn) => opts.events.onStop(fn) },
      );
    },
  );

  const action = (name: BoardAction, summary: string) =>
    app.post(
      `/stalls/:stallId/orders/:orderId/${name}`,
      {
        preHandler: stallAccess,
        schema: {
          tags: ['vendor'],
          summary,
          params: orderParams,
          ...(name === 'reject'
            ? {
                body: z.object({
                  reason: z
                    .string()
                    .trim()
                    .min(3, 'Tell the student why (at least 3 characters)')
                    .max(200, 'Keep the reason under 200 characters'),
                }),
              }
            : {}),
          response: {
            200: z.object({
              order: boardOrder,
              refund: z.enum(['started', 'retry_later', 'none']),
            }),
          },
        },
      },
      async (req) => {
        const { stallId, orderId } = req.params;
        const { refund } = await moveOrder(
          app.db,
          opts.gateway,
          {
            stallId,
            orderId,
            action: name,
            reason: (req.body as { reason?: string } | undefined)?.reason,
            actorId: req.auth!.userId,
            now: now(),
          },
          req.log,
        );
        return { order: await getBoardOrder(app.db, stallId, orderId), refund };
      },
    );

  action('accept', 'Accept an order and start preparing it');
  action('ready', 'Mark an order ready for pickup (the student is told at once)');
  action('reject', 'Reject an order with a reason (paid UPI orders are refunded in full)');

  // Rate-limited per person: the manual check is token + a 4-digit code, so guessing must be slow.
  const perUser = (max: number) => ({
    rateLimit: {
      max,
      timeWindow: '1 minute',
      hook: 'preHandler' as const,
      keyGenerator: (req: { auth?: { userId: string } | null; ip: string }) =>
        req.auth ? `user:${req.auth.userId}` : `ip:${req.ip}`,
    },
  });

  app.post(
    '/stalls/:stallId/pickup/verify',
    {
      preHandler: stallAccess,
      config: perUser(60),
      schema: {
        tags: ['vendor'],
        summary:
          'Check an order at the counter: scanned QR, or token + 4-digit pickup code (changes nothing)',
        params,
        body: z.union([
          z.object({ qr: z.string().trim().min(1).max(200) }),
          z.object({
            tokenNo: z.number().int().min(1).max(9999),
            pickupCode: z.string().regex(/^\d{4}$/, 'The pickup code is 4 digits'),
          }),
        ]),
        response: {
          200: z.discriminatedUnion('valid', [
            z.object({
              valid: z.literal(true),
              order: boardOrder,
              warning: z.enum(['not_ready']).nullable(),
              cashDuePaise: z.number().int(),
            }),
            z.object({
              valid: z.literal(false),
              reason: z.enum(['unknown', 'wrong_stall', 'already_collected', 'not_paid', 'cancelled']),
              message: z.string(),
              order: boardOrder.nullable(),
            }),
          ]),
        },
      },
    },
    async (req) => {
      const result = await verifyPickup(app.db, {
        ...req.body,
        stallId: req.params.stallId,
        qrSecret: opts.qrSecret,
        now: now(),
      });
      if (!result.valid) {
        req.log.info({ stallId: req.params.stallId, reason: result.reason }, 'pickup check refused');
      }
      return result;
    },
  );

  app.post(
    '/stalls/:stallId/orders/:orderId/handover',
    {
      preHandler: stallAccess,
      schema: {
        tags: ['vendor'],
        summary:
          'Hand an order over (→ collected). Cash orders need cashReceived: true (→ paid_cash, fees recorded)',
        params: orderParams,
        body: z.object({ cashReceived: z.boolean().default(false) }),
        response: { 200: z.object({ order: boardOrder }) },
      },
    },
    async (req) => ({
      order: await handOver(app.db, {
        stallId: req.params.stallId,
        orderId: req.params.orderId,
        cashReceived: req.body.cashReceived,
        actorId: req.auth!.userId,
        now: now(),
      }),
    }),
  );
};
