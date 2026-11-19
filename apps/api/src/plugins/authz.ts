import { and, eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { stallMembers, users } from '../db/schema/index.js';
import { forbidden, unauthenticated } from '../lib/errors.js';
import type { Role } from '../modules/auth/tokens.js';

type PreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * preHandler: the signed-in user must have one of `roles` (from the access token).
 * Use after `app.requireAuth`.
 */
export function requireRole(...roles: Role[]): PreHandler {
  return async (request) => {
    if (!request.auth) throw unauthenticated();
    if (!roles.includes(request.auth.role)) throw forbidden();
  };
}

/**
 * preHandler: the user may manage the stall in `params[param]` — a member of that stall
 * (optionally with one of `memberRoles`), or a super admin. Checked against the database
 * on every request, so removing someone from a stall takes effect immediately.
 *
 * Answers 403 whether or not the stall exists, so outsiders can't probe for stall ids.
 * Validate the param's format (uuid) in the route schema; it runs before this hook.
 */
export function requireStallAccess(
  db: Db,
  options: { param?: string; memberRoles?: Array<'owner' | 'staff'> } = {},
): PreHandler {
  const param = options.param ?? 'stallId';
  return async (request) => {
    const auth = request.auth;
    if (!auth) throw unauthenticated();
    if (auth.role === 'super_admin') return;
    const stallId = (request.params as Record<string, string | undefined>)[param];
    if (!stallId) throw forbidden();
    const [member] = await db
      .select({ role: stallMembers.role })
      .from(stallMembers)
      .where(and(eq(stallMembers.stallId, stallId), eq(stallMembers.userId, auth.userId)));
    if (!member || (options.memberRoles && !options.memberRoles.includes(member.role))) {
      request.log.warn({ userId: auth.userId, stallId }, 'stall access denied');
      throw forbidden("You don't manage this stall");
    }
  };
}

/**
 * preHandler for the admin console: the access token says super_admin AND the database still
 * agrees (active, not deleted, still super_admin). Admin powers end the moment an admin is
 * removed or suspended, instead of when their 15-minute access token expires.
 */
export function requireSuperAdmin(db: Db): PreHandler {
  return async (request) => {
    const auth = request.auth;
    if (!auth) throw unauthenticated();
    if (auth.role !== 'super_admin') throw forbidden();
    const [user] = await db
      .select({ role: users.role, status: users.status, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, auth.userId));
    if (!user || user.deletedAt || user.status !== 'active' || user.role !== 'super_admin') {
      request.log.warn({ userId: auth.userId }, 'admin access denied: no longer an active super admin');
      throw forbidden();
    }
  };
}
