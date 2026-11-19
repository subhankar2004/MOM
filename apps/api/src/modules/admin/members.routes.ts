import { normalizeIndianMobile } from '@mom/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest } from '../../lib/errors.js';
import { requireSuperAdmin } from '../../plugins/authz.js';
import { listStallMembers, registerStallMember, setUserSuspended } from '../access/access.service.js';

const phoneField = z.string().transform((v, ctx) => {
  const e164 = normalizeIndianMobile(v);
  if (!e164) {
    ctx.addIssue({ code: 'custom', message: 'Enter a 10-digit Indian mobile number' });
    return z.NEVER;
  }
  return e164;
});

/** /v1/admin/... — super admin only. Every change is written to the audit log. */
export const adminAccessRoutes: FastifyPluginAsyncZod = async (app) => {
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

  app.post(
    '/stalls/:stallId/members',
    {
      schema: {
        tags: ['admin'],
        summary: "Register a stall owner's (or staff member's) phone number",
        params: z.object({ stallId: z.uuid('Not a valid stall id') }),
        body: z.object({ phone: phoneField, role: z.enum(['owner', 'staff']).default('owner') }),
        response: {
          201: z.object({
            inviteId: z.uuid(),
            phone: z.string(),
            role: z.enum(['owner', 'staff']),
            /** true if the person already had an account and has access now. */
            activeNow: z.boolean(),
          }),
        },
      },
    },
    async (req, reply) =>
      reply
        .status(201)
        .send(await registerStallMember(app.db, { stallId: req.params.stallId, ...req.body }, actor(req))),
  );

  app.get(
    '/stalls/:stallId/members',
    {
      schema: {
        tags: ['admin'],
        summary: 'Members and pending invites of a stall',
        params: z.object({ stallId: z.uuid('Not a valid stall id') }),
        response: {
          200: z.object({
            members: z.array(
              z.object({
                userId: z.uuid(),
                name: z.string().nullable(),
                phone: z.string().nullable(),
                role: z.enum(['owner', 'staff']),
              }),
            ),
            pending: z.array(
              z.object({ phone: z.string(), role: z.enum(['owner', 'staff']), invitedAt: z.date() }),
            ),
          }),
        },
      },
    },
    async (req) => listStallMembers(app.db, req.params.stallId),
  );

  app.post(
    '/users/:userId/suspension',
    {
      schema: {
        tags: ['admin'],
        summary: 'Suspend or reactivate an account (suspending ends all its sessions)',
        params: z.object({ userId: z.uuid('Not a valid user id') }),
        body: z.object({ suspended: z.boolean() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      if (req.params.userId === req.auth!.userId && req.body.suspended) {
        throw badRequest("You can't suspend your own account");
      }
      await setUserSuspended(app.db, req.params.userId, req.body.suspended, actor(req));
      return reply.status(204).send(null);
    },
  );
};
