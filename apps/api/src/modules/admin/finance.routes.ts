import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { stalls } from '../../db/schema/index.js';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { requireSuperAdmin } from '../../plugins/authz.js';
import { eq } from 'drizzle-orm';
import { recordAdjustment } from '../finance/ledger.js';
import { reconcile, recentRuns } from '../finance/reconcile.service.js';
import { istDay } from '../orders/orders.service.js';
import type { RevenueService } from './revenue.service.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const paise = z.number().int();

const issue = z.object({
  kind: z.string(),
  severity: z.enum(['error', 'warning']),
  orderId: z.string(),
  message: z.string(),
  expectedPaise: paise.optional(),
  actualPaise: paise.optional(),
});
const run = z.object({
  id: z.number().int(),
  ranAt: z.date(),
  periodStart: z.date(),
  periodEnd: z.date(),
  ordersChecked: z.number().int(),
  status: z.enum(['ok', 'mismatch']),
  issues: z.array(issue),
  startedBy: z.string().nullable(),
});

/** /v1/admin/{overview,revenue,reconciliation,ledger} — money for super admins (spec A1, A2). */
export const adminFinanceRoutes: FastifyPluginAsyncZod<{
  revenue: RevenueService;
  now?: () => Date;
}> = async (app, opts) => {
  const now = opts.now ?? (() => new Date());
  app.addHook('preHandler', app.requireAuth);
  app.addHook('preHandler', requireSuperAdmin(app.db));

  app.get(
    '/overview',
    {
      schema: {
        tags: ['admin'],
        summary:
          "Today's orders, order value, MOM revenue, live orders, failed payments, stalls, last reconciliation",
        response: {
          200: z.object({
            day: z.string(),
            today: z.object({
              orders: z.number().int(),
              collected: z.number().int(),
              upiOrders: z.number().int(),
              cashOrders: z.number().int(),
              orderValuePaise: paise,
              revenuePaise: paise,
              failedPayments: z.number().int(),
            }),
            live: z.object({
              placed: z.number().int(),
              preparing: z.number().int(),
              ready: z.number().int(),
            }),
            stalls: z.object({
              active: z.number().int(),
              openNow: z.number().int(),
              draft: z.number().int(),
              payoutsInReview: z.number().int(),
            }),
            attention: z.object({ refundPending: z.number().int() }),
            reconciliation: z
              .object({
                ranAt: z.date(),
                status: z.enum(['ok', 'mismatch']),
                errors: z.number().int(),
                warnings: z.number().int(),
              })
              .nullable(),
          }),
        },
      },
    },
    async () => opts.revenue.overview(now()),
  );

  app.get(
    '/revenue',
    {
      schema: {
        tags: ['admin'],
        summary: 'MOM revenue from the ledger for India dates (default: last 30 days), by day, week or month',
        querystring: z.object({
          from: date.optional(),
          to: date.optional(),
          group: z.enum(['day', 'week', 'month']).default('day'),
        }),
        response: {
          200: z.object({
            period: z.object({ from: z.string(), to: z.string(), group: z.enum(['day', 'week', 'month']) }),
            totals: z.object({
              platformFeesPaise: paise,
              cashFeesPaise: paise,
              refundedPaise: paise,
              adjustmentsPaise: paise,
              netPaise: paise,
            }),
            series: z.array(
              z.object({
                bucket: z.string(),
                platformFeesPaise: paise,
                cashFeesPaise: paise,
                netPaise: paise,
              }),
            ),
            byStall: z.array(
              z.object({
                stallId: z.string(),
                stallName: z.string(),
                orders: z.number().int(),
                orderValuePaise: paise,
                platformFeesPaise: paise,
                cashFeesPaise: paise,
                refundedPaise: paise,
                netPaise: paise,
              }),
            ),
            mix: z.object({
              upi: z.object({ orders: z.number().int(), valuePaise: paise }),
              cash: z.object({ orders: z.number().int(), valuePaise: paise }),
            }),
          }),
        },
      },
    },
    async (req) => {
      const to = req.query.to ?? istDay(now());
      const from =
        req.query.from ?? istDay(new Date(new Date(`${to}T12:00:00+05:30`).getTime() - 29 * 86_400_000));
      return opts.revenue.revenue({ from, to, group: req.query.group });
    },
  );

  app.get(
    '/reconciliation',
    {
      schema: {
        tags: ['admin'],
        summary: 'Recent reconciliation runs (ledger vs orders vs Razorpay payments)',
        response: { 200: z.object({ runs: z.array(run) }) },
      },
    },
    async () => ({ runs: await recentRuns(app.db, 10) }),
  );

  app.post(
    '/reconciliation/run',
    {
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
      schema: {
        tags: ['admin'],
        summary: 'Run the reconciliation now for orders of the last N days (default 7)',
        body: z.object({ days: z.number().int().min(1).max(90).default(7) }),
        response: { 200: z.object({ run }) },
      },
    },
    async (req) => ({
      run: await reconcile(app.db, { now: now(), days: req.body.days, startedBy: req.auth!.userId }, req.log),
    }),
  );

  app.post(
    '/ledger/adjustments',
    {
      schema: {
        tags: ['admin'],
        summary:
          'Add a correction to the ledger: credit = the stall owes MOM more, debit = MOM gives back (audited)',
        body: z.object({
          stallId: z.uuid('Not a valid stall id'),
          direction: z.enum(['credit', 'debit']),
          amountPaise: z.number().int().min(1).max(10_000_000, 'At most ₹1,00,000 at a time'),
          note: z.string().trim().min(3, 'Say why (at least 3 characters)').max(200),
          orderId: z.uuid().optional(),
        }),
        response: { 201: z.object({ id: z.number().int() }) },
      },
    },
    async (req, reply) => {
      const entry = await app.db.transaction(async (tx) => {
        const [stall] = await tx
          .select({ id: stalls.id })
          .from(stalls)
          .where(eq(stalls.id, req.body.stallId));
        if (!stall) throw notFound('Stall not found');
        const created = await recordAdjustment(tx, { ...req.body, createdBy: req.auth!.userId });
        await audit(tx, {
          actorId: req.auth!.userId,
          action: 'ledger.adjustment',
          entity: 'stall',
          entityId: req.body.stallId,
          after: { ledgerEntryId: created.id, ...req.body },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        });
        return created;
      });
      return reply.status(201).send({ id: entry.id });
    },
  );
};
