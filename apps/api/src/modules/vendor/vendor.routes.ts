import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { stalls } from '../../db/schema/index.js';
import { notFound } from '../../lib/errors.js';
import { requireRole, requireStallAccess } from '../../plugins/authz.js';
import { stallsForUser } from '../access/access.service.js';

const stallSummary = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(['draft', 'active', 'suspended']),
  /** The caller's role at this stall; null for super admins (they see every stall). */
  memberRole: z.enum(['owner', 'staff']).nullable(),
});

const stallParams = z.object({ stallId: z.uuid('Not a valid stall id') });

/** /v1/vendor/... — the stall console. Every route needs a stall role (or super admin). */
export const vendorRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.requireAuth);
  app.addHook('preHandler', requireRole('vendor_owner', 'vendor_staff', 'super_admin'));

  app.get(
    '/stalls',
    {
      schema: {
        tags: ['vendor'],
        summary: 'Stalls I can manage',
        response: { 200: z.object({ stalls: z.array(stallSummary) }) },
      },
    },
    async (req) => ({ stalls: await stallsForUser(app.db, req.auth!.userId, req.auth!.role) }),
  );

  app.get(
    '/stalls/:stallId',
    {
      preHandler: requireStallAccess(app.db),
      schema: {
        tags: ['vendor'],
        summary: 'One of my stalls',
        params: stallParams,
        response: {
          200: z.object({
            stall: stallSummary.omit({ memberRole: true }).extend({
              description: z.string().nullable(),
              location: z.string().nullable(),
              acceptingOrders: z.boolean(),
              upiEnabled: z.boolean(),
              cashEnabled: z.boolean(),
            }),
          }),
        },
      },
    },
    async (req) => {
      const [stall] = await app.db.select().from(stalls).where(eq(stalls.id, req.params.stallId));
      if (!stall) throw notFound('Stall not found');
      return { stall };
    },
  );
};
