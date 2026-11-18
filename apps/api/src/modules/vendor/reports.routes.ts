import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireRole, requireStallAccess } from '../../plugins/authz.js';
import { istDay } from '../orders/orders.service.js';
import { stallReport } from './reports.service.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const paise = z.number().int();

/** /v1/vendor/stalls/:stallId/reports — sales & dues (spec §6.2 V8). Owners only: staff see no finance. */
export const reportsRoutes: FastifyPluginAsyncZod<{ now?: () => Date }> = async (app, opts) => {
  const now = opts.now ?? (() => new Date());
  app.addHook('preHandler', app.requireAuth);
  app.addHook('preHandler', requireRole('vendor_owner', 'super_admin'));
  app.addHook('preHandler', requireStallAccess(app.db, { memberRoles: ['owner'] }));

  app.get(
    '/stalls/:stallId/reports',
    {
      schema: {
        tags: ['vendor'],
        summary:
          'Sales & dues for India dates from–to (inclusive, default today, at most 3 months). Fees and dues come from the ledger',
        params: z.object({ stallId: z.uuid('Not a valid stall id') }),
        querystring: z.object({ from: date.optional(), to: date.optional() }),
        response: {
          200: z.object({
            period: z.object({ from: z.string(), to: z.string() }),
            orders: z.object({
              collected: z.number().int(),
              upi: z.number().int(),
              cash: z.number().int(),
              rejected: z.number().int(),
              cancelled: z.number().int(),
            }),
            sales: z.object({ grossPaise: paise, upiPaise: paise, cashPaise: paise, cashTakenPaise: paise }),
            fees: z.object({
              platformFeesPaise: paise,
              cashFeesPaise: paise,
              refundedPaise: paise,
              adjustmentsPaise: paise,
              netPaise: paise,
            }),
            dues: z.object({ owedPaise: paise, settledPaise: paise, outstandingPaise: paise }),
            payouts: z.object({ upiDuePaise: paise, transfersReceivedPaise: paise.nullable() }),
            daily: z.array(
              z.object({
                day: z.string(),
                orders: z.number().int(),
                grossPaise: paise,
                upiPaise: paise,
                cashPaise: paise,
                feesPaise: paise,
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const today = istDay(now());
      const to = req.query.to ?? today;
      return stallReport(app.db, req.params.stallId, { from: req.query.from ?? to, to });
    },
  );
};
