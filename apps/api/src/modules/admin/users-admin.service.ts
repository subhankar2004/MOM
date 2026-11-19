import { and, desc, eq, ilike, isNull, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { orders, refreshTokens, stallMembers, stalls, users } from '../../db/schema/index.js';
import { audit } from '../../lib/audit.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import type { ActorMeta } from '../access/access.service.js';

type UserRow = typeof users.$inferSelect;
export type UserRole = UserRow['role'];
export type UserStatus = UserRow['status'];

function escapeLike(text: string) {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Phone search works with "98765 43210", "+919876543210" or just "43210". */
function phoneDigits(q: string): string | null {
  const digits = q.replace(/\D/g, '');
  return digits.length >= 3 ? digits.replace(/^91(?=\d{10}$)/, '') : null;
}

/**
 * Users & access for super admins (spec §6.3 A4). Every change is audited; super-admin changes
 * need a typed confirmation and can never leave MOM without an active super admin.
 */
export class UsersAdminService {
  constructor(
    private readonly db: Db,
    /** SUPER_ADMIN_PHONES: these become super admin again at every sign-in. */
    private readonly envSuperAdmins: string[],
  ) {}

  async list(filter: { q?: string; role?: UserRole; status?: UserStatus; before?: string; limit: number }) {
    const q = filter.q?.trim();
    const digits = q ? phoneDigits(q) : null;
    const rows = await this.db
      .select({
        id: users.id,
        name: users.name,
        phone: users.phone,
        role: users.role,
        status: users.status,
        cashStrikes: users.cashStrikes,
        createdAt: users.createdAt,
        orders: sql<number>`(select count(*)::int from orders o where o.user_id = "users"."id")`,
      })
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          filter.role ? eq(users.role, filter.role) : undefined,
          filter.status ? eq(users.status, filter.status) : undefined,
          q
            ? or(
                ilike(users.name, `%${escapeLike(q)}%`),
                digits ? ilike(users.phone, `%${escapeLike(digits)}%`) : undefined,
              )
            : undefined,
          filter.before
            ? sql`(${users.createdAt}, ${users.id}) < (select u.created_at, u.id from users u where u.id = ${filter.before})`
            : undefined,
        ),
      )
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(filter.limit + 1);
    const page = rows.slice(0, filter.limit);
    return { users: page, nextBefore: rows.length > filter.limit ? page.at(-1)!.id : null };
  }

  async get(userId: string) {
    const user = await this.load(this.db, userId);
    const [memberships, recentOrders, [sessions]] = await Promise.all([
      this.db
        .select({ stallId: stalls.id, stallName: stalls.name, role: stallMembers.role })
        .from(stallMembers)
        .innerJoin(stalls, eq(stalls.id, stallMembers.stallId))
        .where(eq(stallMembers.userId, userId)),
      this.db
        .select({
          id: orders.id,
          stallName: stalls.name,
          tokenNo: orders.tokenNo,
          status: orders.status,
          paymentMethod: orders.paymentMethod,
          paymentStatus: orders.paymentStatus,
          totalPaise: orders.totalPaise,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .innerJoin(stalls, eq(stalls.id, orders.stallId))
        .where(eq(orders.userId, userId))
        .orderBy(desc(orders.createdAt))
        .limit(20),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(refreshTokens)
        .where(
          and(
            eq(refreshTokens.userId, userId),
            isNull(refreshTokens.revokedAt),
            sql`${refreshTokens.expiresAt} > now()`,
          ),
        ),
    ]);
    return {
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        status: user.status,
        cashStrikes: user.cashStrikes,
        createdAt: user.createdAt,
      },
      memberships,
      recentOrders,
      activeSessions: sessions?.n ?? 0,
      /** Listed in the server's SUPER_ADMIN_PHONES: always made super admin again at sign-in. */
      superAdminFromSettings: user.phone !== null && this.envSuperAdmins.includes(user.phone),
    };
  }

  /** Signs the user out everywhere: their sessions stop at once, open pages within 15 min. */
  async forceSignOut(userId: string, actor: ActorMeta) {
    await this.db.transaction(async (tx) => {
      await this.load(tx, userId);
      const revoked = await revokeSessions(tx, userId);
      await audit(tx, {
        actorId: actor.actorId,
        action: 'user.force_sign_out',
        entity: 'user',
        entityId: userId,
        after: { sessionsEnded: revoked },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    });
    return this.get(userId);
  }

  async resetCashStrikes(userId: string, actor: ActorMeta) {
    await this.db.transaction(async (tx) => {
      const user = await this.load(tx, userId, true);
      if (user.cashStrikes === 0) return;
      await tx.update(users).set({ cashStrikes: 0 }).where(eq(users.id, userId));
      await audit(tx, {
        actorId: actor.actorId,
        action: 'user.cash_strikes.reset',
        entity: 'user',
        entityId: userId,
        before: { cashStrikes: user.cashStrikes },
        after: { cashStrikes: 0 },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    });
    return this.get(userId);
  }

  /**
   * Makes someone a super admin, or removes it. The admin must type the last 4 digits of the
   * person's phone (so the wrong row is never changed by a stray click). Removing it can't
   * leave MOM without an active super admin, and returns the person to their stall role.
   */
  async setSuperAdmin(userId: string, grant: boolean, confirmLast4: string, actor: ActorMeta) {
    await this.db.transaction(async (tx) => {
      // Serialise super-admin changes so two admins can't remove each other at the same moment.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mom.super_admins'))`);
      const user = await this.load(tx, userId, true);
      if (!user.phone || user.phone.slice(-4) !== confirmLast4) {
        throw badRequest('Type the last 4 digits of their phone number to confirm');
      }
      if (grant) {
        if (user.role === 'super_admin') return;
        if (user.status !== 'active') throw conflict('Reactivate this account first');
        await tx.update(users).set({ role: 'super_admin' }).where(eq(users.id, userId));
      } else {
        if (user.role !== 'super_admin') return;
        if (this.envSuperAdmins.includes(user.phone)) {
          throw conflict(
            'This number is listed in the server setting SUPER_ADMIN_PHONES, so it would become super admin again at its next sign-in. Remove it there first.',
          );
        }
        await assertAnotherActiveSuperAdmin(tx, userId);
        const [membership] = await tx
          .select({ role: stallMembers.role })
          .from(stallMembers)
          .where(eq(stallMembers.userId, userId))
          .orderBy(sql`case when ${stallMembers.role} = 'owner' then 0 else 1 end`)
          .limit(1);
        const role: UserRole = membership
          ? membership.role === 'owner'
            ? 'vendor_owner'
            : 'vendor_staff'
          : 'student';
        await tx.update(users).set({ role }).where(eq(users.id, userId));
        // Their admin pages stop at once (the admin API checks the database); sign them out too.
        await revokeSessions(tx, userId);
      }
      const [after] = await tx.select({ role: users.role }).from(users).where(eq(users.id, userId));
      await audit(tx, {
        actorId: actor.actorId,
        action: grant ? 'user.super_admin.grant' : 'user.super_admin.revoke',
        entity: 'user',
        entityId: userId,
        before: { role: user.role },
        after: { role: after!.role },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    });
    return this.get(userId);
  }

  private async load(db: Db, userId: string, forUpdate = false): Promise<UserRow> {
    const query = db.select().from(users).where(eq(users.id, userId));
    const [user] = forUpdate ? await query.for('update') : await query;
    if (!user || user.deletedAt) throw notFound('User not found');
    return user;
  }
}

/** Ends every session of a user. Returns how many were active. */
export async function revokeSessions(db: Db, userId: string): Promise<number> {
  const rows = await db
    .update(refreshTokens)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });
  return rows.length;
}

/** Throws unless some other active super admin exists (MOM must never be left without one). */
export async function assertAnotherActiveSuperAdmin(db: Db, userId: string): Promise<void> {
  const [other] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, 'super_admin'),
        eq(users.status, 'active'),
        isNull(users.deletedAt),
        ne(users.id, userId),
      ),
    )
    .limit(1);
  if (!other) {
    throw new AppError(
      409,
      'CONFLICT',
      'MOM needs at least one active super admin. Make someone else one first.',
    );
  }
}
