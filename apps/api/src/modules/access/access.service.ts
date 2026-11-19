import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { refreshTokens, stallMembers, stalls, users, vendorInvites } from '../../db/schema/index.js';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import type { Role } from '../auth/tokens.js';
import { assertAnotherActiveSuperAdmin } from '../admin/users-admin.service.js';

type UserRow = typeof users.$inferSelect;
export type MemberRole = 'owner' | 'staff';

/** The global role a user should have given their stall memberships (super admin always wins). */
function roleFor(current: Role, memberships: MemberRole[]): Role {
  if (current === 'super_admin') return 'super_admin';
  if (memberships.includes('owner')) return 'vendor_owner';
  if (memberships.includes('staff')) return 'vendor_staff';
  return current;
}

/**
 * Runs inside the sign-in transaction (spec §3):
 *  1. phones in SUPER_ADMIN_PHONES become super admins (bootstrap — no database access needed);
 *  2. pending vendor invites for this phone turn into stall memberships, and the user's role
 *     becomes vendor_owner / vendor_staff.
 * Returns the user as it should be signed in.
 */
export async function applyAccessOnSignIn(
  db: Db,
  user: UserRow,
  superAdminPhones: string[],
): Promise<UserRow> {
  let current = user;

  if (current.phone && superAdminPhones.includes(current.phone) && current.role !== 'super_admin') {
    const [promoted] = await db
      .update(users)
      .set({ role: 'super_admin' })
      .where(eq(users.id, current.id))
      .returning();
    await audit(db, {
      actorId: null,
      action: 'user.role.bootstrap_super_admin',
      entity: 'user',
      entityId: current.id,
      before: { role: current.role },
      after: { role: 'super_admin' },
    });
    current = promoted!;
  }

  if (!current.phone) return current;
  const invites = await db
    .select()
    .from(vendorInvites)
    .where(and(eq(vendorInvites.phone, current.phone), isNull(vendorInvites.acceptedAt)));
  if (invites.length === 0) return current;

  for (const invite of invites) {
    await db
      .insert(stallMembers)
      .values({ stallId: invite.stallId, userId: current.id, role: invite.role })
      .onConflictDoUpdate({
        target: [stallMembers.stallId, stallMembers.userId],
        set: { role: invite.role },
      });
    await db
      .update(vendorInvites)
      .set({ acceptedAt: sql`now()` })
      .where(eq(vendorInvites.id, invite.id));
    await audit(db, {
      actorId: null,
      action: 'stall.member.accept_invite',
      entity: 'stall',
      entityId: invite.stallId,
      after: { userId: current.id, role: invite.role },
    });
  }
  return syncRole(db, current);
}

/** Recomputes the user's global role from their memberships and saves it if it changed. */
async function syncRole(db: Db, user: UserRow): Promise<UserRow> {
  const memberships = await db
    .select({ role: stallMembers.role })
    .from(stallMembers)
    .where(eq(stallMembers.userId, user.id));
  const next = roleFor(
    user.role,
    memberships.map((m) => m.role),
  );
  if (next === user.role) return user;
  const [updated] = await db.update(users).set({ role: next }).where(eq(users.id, user.id)).returning();
  await audit(db, {
    actorId: null,
    action: 'user.role.sync_from_stalls',
    entity: 'user',
    entityId: user.id,
    before: { role: user.role },
    after: { role: next },
  });
  return updated!;
}

export interface ActorMeta {
  actorId: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Super admin registers a phone for a stall. If the person already has an account they get
 * access immediately (their next token refresh — ≤ 15 min — carries the new role); otherwise
 * on their first sign-in. Idempotent: registering the same phone again updates the role.
 */
export async function registerStallMember(
  db: Db,
  input: { stallId: string; phone: string; role: MemberRole },
  actor: ActorMeta,
) {
  return db.transaction(async (tx) => {
    const [stall] = await tx.select({ id: stalls.id }).from(stalls).where(eq(stalls.id, input.stallId));
    if (!stall) throw notFound('Stall not found');

    const [invite] = await tx
      .insert(vendorInvites)
      .values({ phone: input.phone, stallId: input.stallId, role: input.role, invitedBy: actor.actorId })
      .onConflictDoUpdate({
        target: [vendorInvites.phone, vendorInvites.stallId],
        set: { role: input.role, invitedBy: actor.actorId },
      })
      .returning();

    const [existing] = await tx
      .select()
      .from(users)
      .where(and(eq(users.phone, input.phone), isNull(users.deletedAt)));
    let activeNow = false;
    if (existing) {
      await tx
        .insert(stallMembers)
        .values({ stallId: input.stallId, userId: existing.id, role: input.role })
        .onConflictDoUpdate({
          target: [stallMembers.stallId, stallMembers.userId],
          set: { role: input.role },
        });
      await tx
        .update(vendorInvites)
        .set({ acceptedAt: sql`now()` })
        .where(eq(vendorInvites.id, invite!.id));
      await syncRole(tx, existing);
      activeNow = true;
    }

    await audit(tx, {
      actorId: actor.actorId,
      action: 'stall.member.register',
      entity: 'stall',
      entityId: input.stallId,
      after: { phone: input.phone, role: input.role, activeNow },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return { inviteId: invite!.id, phone: input.phone, role: input.role, activeNow };
  });
}

/** Members and still-pending invites of a stall (admin view). */
export async function listStallMembers(db: Db, stallId: string) {
  const [stall] = await db.select({ id: stalls.id }).from(stalls).where(eq(stalls.id, stallId));
  if (!stall) throw notFound('Stall not found');
  const members = await db
    .select({ userId: users.id, name: users.name, phone: users.phone, role: stallMembers.role })
    .from(stallMembers)
    .innerJoin(users, eq(users.id, stallMembers.userId))
    .where(eq(stallMembers.stallId, stallId))
    .orderBy(asc(stallMembers.createdAt));
  const pending = await db
    .select({ phone: vendorInvites.phone, role: vendorInvites.role, invitedAt: vendorInvites.createdAt })
    .from(vendorInvites)
    .where(and(eq(vendorInvites.stallId, stallId), isNull(vendorInvites.acceptedAt)))
    .orderBy(asc(vendorInvites.createdAt));
  return { members, pending };
}

/** Stalls a user may manage: all of them for a super admin, otherwise their memberships. */
export async function stallsForUser(db: Db, userId: string, role: Role) {
  const columns = { id: stalls.id, slug: stalls.slug, name: stalls.name, status: stalls.status };
  if (role === 'super_admin') {
    const all = await db.select(columns).from(stalls).orderBy(asc(stalls.name));
    return all.map((s) => ({ ...s, memberRole: null }));
  }
  return db
    .select({ ...columns, memberRole: stallMembers.role })
    .from(stallMembers)
    .innerJoin(stalls, eq(stalls.id, stallMembers.stallId))
    .where(eq(stallMembers.userId, userId))
    .orderBy(asc(stalls.name));
}

/**
 * Suspends (or reactivates) an account. Suspension revokes every session at once: refresh
 * stops working immediately and the last access token expires within 15 minutes (spec §3).
 */
export async function setUserSuspended(db: Db, userId: string, suspended: boolean, actor: ActorMeta) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mom.super_admins'))`);
    const [before] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (!before || before.deletedAt) throw notFound('User not found');
    // Suspending the last active super admin would lock everyone out of the admin console.
    if (suspended && before.role === 'super_admin') await assertAnotherActiveSuperAdmin(tx, userId);
    const status = suspended ? 'suspended' : 'active';
    await tx.update(users).set({ status }).where(eq(users.id, userId));
    if (suspended) {
      await tx
        .update(refreshTokens)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    }
    await audit(tx, {
      actorId: actor.actorId,
      action: suspended ? 'user.suspend' : 'user.reactivate',
      entity: 'user',
      entityId: userId,
      before: { status: before.status },
      after: { status },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  });
}
