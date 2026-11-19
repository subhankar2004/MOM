import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireSuperAdmin } from '../../plugins/authz.js';
import type { UsersAdminService } from './users-admin.service.js';

const role = z.enum(['student', 'vendor_owner', 'vendor_staff', 'super_admin']);
const status = z.enum(['active', 'suspended']);
const userParams = z.object({ userId: z.uuid('Not a valid user id') });
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

const userDetail = z.object({
  user: z.object({
    id: z.uuid(),
    name: z.string().nullable(),
    phone: z.string().nullable(),
    role,
    status,
    cashStrikes: z.number().int(),
    createdAt: z.date(),
  }),
  memberships: z.array(
    z.object({ stallId: z.uuid(), stallName: z.string(), role: z.enum(['owner', 'staff']) }),
  ),
  recentOrders: z.array(
    z.object({
      id: z.uuid(),
      stallName: z.string(),
      tokenNo: z.number().int().nullable(),
      status: orderStatus,
      paymentMethod: z.enum(['upi', 'cash']),
      paymentStatus,
      totalPaise: z.number().int(),
      createdAt: z.date(),
    }),
  ),
  activeSessions: z.number().int(),
  superAdminFromSettings: z.boolean(),
});

/** /v1/admin/users — users & access (spec §6.3 A4). Super admin only; every action audited. */
export const adminUsersRoutes: FastifyPluginAsyncZod<{ users: UsersAdminService }> = async (app, opts) => {
  const { users } = opts;
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
    '/users',
    {
      schema: {
        tags: ['admin'],
        summary: 'Search users by phone or name; filter by role or status (newest first, paginated)',
        querystring: z.object({
          q: z.string().max(60).optional(),
          role: role.optional(),
          status: status.optional(),
          before: z.uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: {
          200: z.object({
            users: z.array(userDetail.shape.user.extend({ orders: z.number().int() })),
            nextBefore: z.string().nullable(),
          }),
        },
      },
    },
    async (req) => users.list(req.query),
  );

  app.get(
    '/users/:userId',
    {
      schema: {
        tags: ['admin'],
        summary: 'One user: stalls they manage, recent orders, active sessions',
        params: userParams,
        response: { 200: userDetail },
      },
    },
    async (req) => users.get(req.params.userId),
  );

  app.post(
    '/users/:userId/sign-out',
    {
      schema: {
        tags: ['admin'],
        summary: 'Sign the user out on every device (pages already open stop within 15 minutes)',
        params: userParams,
        response: { 200: userDetail },
      },
    },
    async (req) => users.forceSignOut(req.params.userId, actor(req)),
  );

  app.post(
    '/users/:userId/cash-strikes/reset',
    {
      schema: {
        tags: ['admin'],
        summary: "Reset a student's cash no-show strikes (lets them order with cash again)",
        params: userParams,
        response: { 200: userDetail },
      },
    },
    async (req) => users.resetCashStrikes(req.params.userId, actor(req)),
  );

  app.post(
    '/users/:userId/super-admin',
    {
      schema: {
        tags: ['admin'],
        summary:
          'Make someone a super admin, or remove it. Confirm with the last 4 digits of their phone; at least one active super admin always remains',
        params: userParams,
        body: z.object({
          grant: z.boolean(),
          confirmLast4: z.string().regex(/^\d{4}$/, 'Type the last 4 digits of their phone number'),
        }),
        response: { 200: userDetail },
      },
    },
    async (req) => users.setSuperAdmin(req.params.userId, req.body.grant, req.body.confirmLast4, actor(req)),
  );
};
