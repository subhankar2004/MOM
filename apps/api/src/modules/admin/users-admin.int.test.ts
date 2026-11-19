import { decodeJwt } from 'jose';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { auditLog, stallMembers, stalls, users } from '../../db/schema/index.js';
import { createTestApp, testEnv, type TestApp } from '../../test/test-app.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../auth/cookies.js';
import { signAccessToken, type Role } from '../auth/tokens.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

let seq = 0;
const phone = () => `+9197${String(10_000_000 + ++seq).slice(-8)}`;

async function world(env: Record<string, string> = {}) {
  const app = (t = await createTestApp(env));
  const make = async (role: Role, name: string = role, phoneNo = phone()) => {
    const [u] = await app.db.insert(users).values({ phone: phoneNo, name, role }).returning();
    const { token } = await signAccessToken(testEnv().JWT_SECRET, { userId: u!.id, role }, 900);
    return { id: u!.id, phone: phoneNo, cookies: { [ACCESS_COOKIE]: token } };
  };
  const admin = await make('super_admin', 'Admin One');
  const call = (
    method: 'GET' | 'POST',
    url: string,
    payload?: object,
    cookies: Record<string, string> = admin.cookies,
  ) => app.app.inject({ method, url: `/v1/admin${url}`, cookies, payload });
  /** Signs a real user in with an OTP, as on their phone. */
  const signIn = async (phoneNo: string) => {
    await app.app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone: phoneNo } });
    const code = app.sms.at(-1)!.body.match(/\b(\d{6})\b/)![1];
    const res = await app.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: { phone: phoneNo, code },
    });
    expect(res.statusCode).toBe(200);
    const cookie = (name: string) => res.cookies.find((c) => c.name === name)!.value;
    return {
      id: res.json().user.id as string,
      access: cookie(ACCESS_COOKIE),
      refresh: cookie(REFRESH_COOKIE),
    };
  };
  const refresh = (token: string) =>
    app.app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { [REFRESH_COOKIE]: token } });
  const audits = (userId: string) =>
    app.db
      .select({ action: auditLog.action, actorId: auditLog.actorId })
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'user'), eq(auditLog.entityId, userId)));
  return { app, admin, make, call, signIn, refresh, audits };
}

describe('admin users: access', () => {
  it('is for active super admins only, checked against the database', async () => {
    const w = await world();
    const student = await w.make('student');
    expect((await w.call('GET', '/users', undefined, student.cookies)).statusCode).toBe(403);
    // An admin removed a moment ago still has a valid token saying super_admin: refused anyway.
    const exAdmin = await w.make('super_admin');
    await w.app.db.update(users).set({ role: 'student' }).where(eq(users.id, exAdmin.id));
    expect((await w.call('GET', '/users', undefined, exAdmin.cookies)).statusCode).toBe(403);
    expect((await w.call('GET', '/stalls', undefined, exAdmin.cookies)).statusCode).toBe(403);
  });
});

describe('admin users: search and detail', () => {
  it('searches by name or phone and filters by role, with pagination', async () => {
    const w = await world();
    const asha = await w.make('student', 'Asha Mohanty', '+919437012345');
    await w.make('vendor_owner', 'Ravi Kumar', '+919437055555');
    const byName = (await w.call('GET', '/users?q=asha')).json().users;
    expect(byName.map((u: { id: string }) => u.id)).toEqual([asha.id]);
    const byPhone = (await w.call('GET', '/users?q=94370%2012345')).json().users;
    expect(byPhone.map((u: { id: string }) => u.id)).toEqual([asha.id]);
    const owners = (await w.call('GET', '/users?role=vendor_owner&q=9437')).json().users;
    expect(owners.map((u: { name: string }) => u.name)).toEqual(['Ravi Kumar']);

    const page1 = (await w.call('GET', '/users?q=9437&limit=1')).json();
    expect(page1.users).toHaveLength(1);
    const page2 = (await w.call('GET', `/users?q=9437&limit=1&before=${page1.nextBefore}`)).json();
    expect(page2.users).toHaveLength(1);
    expect(page2.users[0].id).not.toBe(page1.users[0].id);
    expect(page2.nextBefore).toBeNull();
  });

  it('shows stalls they manage and their active sessions', async () => {
    const w = await world();
    const owner = await w.make('vendor_owner', 'Owner');
    const [stall] = await w.app.db
      .insert(stalls)
      .values({ slug: `users-${++seq}`, name: 'Owner Stall' })
      .returning();
    await w.app.db.insert(stallMembers).values({ stallId: stall!.id, userId: owner.id, role: 'owner' });
    await w.signIn(owner.phone);
    const d = (await w.call('GET', `/users/${owner.id}`)).json();
    expect(d.memberships).toEqual([{ stallId: stall!.id, stallName: 'Owner Stall', role: 'owner' }]);
    expect(d.activeSessions).toBe(1);
    expect(d.superAdminFromSettings).toBe(false);
    expect((await w.call('GET', `/users/00000000-0000-4000-8000-000000000000`)).statusCode).toBe(404);
  });
});

describe('admin users: suspend and sign out (acceptance)', () => {
  it('suspending a user signs them out within 15 minutes, and is audited', async () => {
    const w = await world();
    const student = await w.make('student', 'Late Student');
    const session = await w.signIn(student.phone);
    // Access tokens live 15 minutes at most.
    const { exp, iat } = decodeJwt(session.access);
    expect(exp! - iat!).toBeLessThanOrEqual(15 * 60);

    const res = await w.call('POST', `/users/${student.id}/suspension`, { suspended: true });
    expect(res.statusCode).toBe(204);
    // Their sessions were ended, so they're out when the access token expires (≤ 15 min)...
    const renewed = await w.refresh(session.refresh);
    expect(renewed.statusCode).toBe(401);
    // ...and pages that check the account (like /me) stop at once.
    const me = await w.app.app.inject({ url: '/v1/me', cookies: { [ACCESS_COOKIE]: session.access } });
    expect(me.statusCode).toBe(403);
    expect((await w.call('GET', `/users/${student.id}`)).json()).toMatchObject({
      user: { status: 'suspended' },
      activeSessions: 0,
    });
    expect(await w.audits(student.id)).toContainEqual({ action: 'user.suspend', actorId: w.admin.id });
  });

  it('force sign-out ends every session, audited', async () => {
    const w = await world();
    const student = await w.make('student');
    const a = await w.signIn(student.phone);
    const res = await w.call('POST', `/users/${student.id}/sign-out`);
    expect(res.json().activeSessions).toBe(0);
    expect((await w.refresh(a.refresh)).statusCode).toBe(401);
    expect(await w.audits(student.id)).toContainEqual({ action: 'user.force_sign_out', actorId: w.admin.id });
  });

  it("can't suspend the last active super admin", async () => {
    const w = await world();
    const other = await w.make('super_admin');
    // Two admins: one may suspend the other...
    expect((await w.call('POST', `/users/${other.id}/suspension`, { suspended: true })).statusCode).toBe(204);
    // ...but the remaining one can't be suspended (by anyone).
    const third = await w.make('super_admin');
    await w.call('POST', `/users/${third.id}/suspension`, { suspended: true });
    const last = await w.call('POST', `/users/${w.admin.id}/suspension`, { suspended: true }, third.cookies);
    expect(last.statusCode).toBe(403); // the suspended third admin has no admin access any more
    const self = await w.call('POST', `/users/${w.admin.id}/suspension`, { suspended: true });
    expect(self.statusCode).toBe(400); // and nobody suspends themself
  });
});

describe('admin users: cash strikes', () => {
  it('resets cash strikes, audited', async () => {
    const w = await world();
    const student = await w.make('student');
    await w.app.db.update(users).set({ cashStrikes: 3 }).where(eq(users.id, student.id));
    const res = await w.call('POST', `/users/${student.id}/cash-strikes/reset`);
    expect(res.json().user.cashStrikes).toBe(0);
    expect(await w.audits(student.id)).toContainEqual({
      action: 'user.cash_strikes.reset',
      actorId: w.admin.id,
    });
  });
});

describe('admin users: super admins', () => {
  it('grants and revokes with a typed confirmation, back to their stall role', async () => {
    const w = await world();
    const owner = await w.make('vendor_owner', 'Owner', '+919437011111');
    const [stall] = await w.app.db
      .insert(stalls)
      .values({ slug: `sa-${++seq}`, name: 'SA Stall' })
      .returning();
    await w.app.db.insert(stallMembers).values({ stallId: stall!.id, userId: owner.id, role: 'owner' });

    const wrong = await w.call('POST', `/users/${owner.id}/super-admin`, {
      grant: true,
      confirmLast4: '0000',
    });
    expect(wrong.statusCode).toBe(400);
    const granted = await w.call('POST', `/users/${owner.id}/super-admin`, {
      grant: true,
      confirmLast4: '1111',
    });
    expect(granted.json().user.role).toBe('super_admin');

    const session = await w.signIn(owner.phone);
    const revoked = await w.call('POST', `/users/${owner.id}/super-admin`, {
      grant: false,
      confirmLast4: '1111',
    });
    expect(revoked.json().user.role).toBe('vendor_owner');
    // Signed out, so their next page load asks them to sign in again (with the new role).
    expect((await w.refresh(session.refresh)).statusCode).toBe(401);
    expect((await w.audits(owner.id)).map((a) => a.action)).toEqual(
      expect.arrayContaining(['user.super_admin.grant', 'user.super_admin.revoke']),
    );
  });

  it('always keeps one active super admin, and respects SUPER_ADMIN_PHONES', async () => {
    const w = await world({ SUPER_ADMIN_PHONES: '9437099999' });
    const last4 = w.admin.phone.slice(-4);
    const alone = await w.call('POST', `/users/${w.admin.id}/super-admin`, {
      grant: false,
      confirmLast4: last4,
    });
    expect(alone.statusCode).toBe(409);
    expect(alone.json().error.message).toMatch(/at least one active super admin/);

    const fromSettings = await w.make('super_admin', 'Founder', '+919437099999');
    const blocked = await w.call('POST', `/users/${fromSettings.id}/super-admin`, {
      grant: false,
      confirmLast4: '9999',
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.message).toMatch(/SUPER_ADMIN_PHONES/);
    expect((await w.call('GET', `/users/${fromSettings.id}`)).json().superAdminFromSettings).toBe(true);
  });
});
