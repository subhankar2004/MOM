import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { orders, transfers } from '../../db/schema/index.js';
import { audit } from '../../lib/audit.js';
import { AppError, notFound } from '../../lib/errors.js';
import { requireSuperAdmin } from '../../plugins/authz.js';
import { recordCashSettlement, settlementBalances, stallStatement } from '../finance/settlements.service.js';
import { dateParam, statementSchema } from '../finance/statement.schema.js';
import { ensureTransfer, releaseTransfer, reverseTransfer } from '../finance/transfers.service.js';
import { istDay } from '../orders/orders.service.js';
import type { PaymentGateway } from '../payments/gateway.js';

const paise = z.number().int();

/** Last Monday–Sunday in India time (the default weekly statement). */
export function lastWeek(now: Date): { from: string; to: string } {
  const today = new Date(`${istDay(now)}T00:00:00Z`);
  const weekday = (today.getUTCDay() + 6) % 7; // Monday = 0
  const thisMonday = new Date(today.getTime() - weekday * 86_400_000);
  const from = new Date(thisMonday.getTime() - 7 * 86_400_000);
  const to = new Date(thisMonday.getTime() - 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/** /v1/admin/settlements, /stalls/:id/statement, cash settlements, transfer retries (spec A6). */
export const adminSettlementsRoutes: FastifyPluginAsyncZod<{
  gateway: PaymentGateway | null;
  now?: () => Date;
}> = async (app, opts) => {
  const now = opts.now ?? (() => new Date());
  app.addHook('preHandler', app.requireAuth);
  app.addHook('preHandler', requireSuperAdmin(app.db));

  app.get(
    '/settlements',
    {
      schema: {
        tags: ['admin'],
        summary: 'Every stall: cash fees owed to MOM, UPI money held and paid out, transfer problems',
        response: {
          200: z.object({
            stalls: z.array(
              z.object({
                stallId: z.string(),
                stallName: z.string(),
                status: z.enum(['draft', 'active', 'suspended']),
                routeStatus: z.string(),
                owedPaise: paise,
                heldPaise: paise,
                heldTransfers: z.number().int(),
                releasedLast7DaysPaise: paise,
                transferProblems: z.number().int(),
                lastSettlementAt: z.date().nullable(),
              }),
            ),
          }),
        },
      },
    },
    async () => ({ stalls: await settlementBalances(app.db, now()) }),
  );

  app.get(
    '/stalls/:stallId/statement',
    {
      schema: {
        tags: ['admin'],
        summary: "A stall's statement for India dates (default: last Monday–Sunday)",
        params: z.object({ stallId: z.uuid('Not a valid stall id') }),
        querystring: z.object({ from: dateParam.optional(), to: dateParam.optional() }),
        response: { 200: statementSchema },
      },
    },
    async (req) => {
      const week = lastWeek(now());
      return stallStatement(app.db, req.params.stallId, {
        from: req.query.from ?? week.from,
        to: req.query.to ?? week.to,
      });
    },
  );

  app.post(
    '/stalls/:stallId/settlements',
    {
      schema: {
        tags: ['admin'],
        summary: 'Record cash dues the stall paid to MOM (at most what it owes; audited)',
        params: z.object({ stallId: z.uuid('Not a valid stall id') }),
        body: z.object({
          amountPaise: z.number().int().min(1, 'Enter an amount').max(100_000_000),
          periodStart: dateParam,
          periodEnd: dateParam,
          note: z.string().trim().max(200).optional(),
        }),
        response: {
          201: z.object({ settlementId: z.uuid(), amountPaise: paise, owedPaise: paise }),
        },
      },
    },
    async (req, reply) => {
      const { settlement, owedPaise } = await recordCashSettlement(app.db, {
        stallId: req.params.stallId,
        ...req.body,
        receivedBy: req.auth!.userId,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return reply
        .status(201)
        .send({ settlementId: settlement.id, amountPaise: settlement.amountPaise, owedPaise });
    },
  );

  app.post(
    '/orders/:orderId/transfer/retry',
    {
      schema: {
        tags: ['admin'],
        summary: "Retry an order's Route transfer now (create, release or reverse, whichever is due)",
        params: z.object({ orderId: z.uuid('Not a valid order id') }),
        response: {
          200: z.object({
            transfer: z.object({
              status: z.enum(['created', 'on_hold', 'released', 'reversed', 'failed']),
              lastError: z.string().nullable(),
            }),
          }),
        },
      },
    },
    async (req) => {
      if (!opts.gateway) throw new AppError(503, 'SERVICE_UNAVAILABLE', 'UPI payments are not configured');
      const [order] = await app.db.select().from(orders).where(eq(orders.id, req.params.orderId));
      if (!order) throw notFound('Order not found');
      const [t] = await app.db.select().from(transfers).where(eq(transfers.orderId, order.id));
      // A transfer that gave up gets a fresh set of attempts.
      if (t?.status === 'failed') {
        await app.db
          .update(transfers)
          .set({ status: t.providerTransferId ? 'on_hold' : 'created', attempts: 0 })
          .where(eq(transfers.id, t.id));
      }
      const refunded = order.paymentStatus === 'refunded' || order.paymentStatus === 'refund_pending';
      if (refunded) await reverseTransfer(app.db, opts.gateway, order.id, now(), req.log);
      else {
        await ensureTransfer(app.db, opts.gateway, order.id, req.log);
        if (order.status === 'collected')
          await releaseTransfer(app.db, opts.gateway, order.id, now(), req.log);
      }
      const [after] = await app.db.select().from(transfers).where(eq(transfers.orderId, order.id));
      if (!after) throw new AppError(409, 'CONFLICT', 'This order has no UPI payout to make');
      await audit(app.db, {
        actorId: req.auth!.userId,
        action: 'order.transfer_retry',
        entity: 'order',
        entityId: order.id,
        after: { status: after.status, lastError: after.lastError },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return { transfer: { status: after.status, lastError: after.lastError } };
    },
  );
};
