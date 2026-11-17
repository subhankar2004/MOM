import { and, eq } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { auditLog, stallMembers, stalls, users, vendorInvites } from '../../db/schema/index.js';
import { createTestApp, testEnv, type TestApp } from '../../test/test-app.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../auth/cookies.js';
import { signAccessToken, type Role } from '../auth/tokens.js';

/**
 * Who may do what (spec §3), against the real database. Each test is rolled back.
 * Sessions are minted directly (users inserted + access token signed with the test secret),
 * except where the sign-in flow itself is under test.
 */
let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const JWT_SECRET = testEnv().JWT_SECRET;
let phoneSeq = 0;
const nextPhone = () => `+9196000${String(10000 + ++phoneSeq).slice(-5)}`;

async function makeUser(app: TestApp, role: Role, name = 'Test') {
  const [user] = await app.db.insert(users).values({ phone: nextPhone(), name, role }).returning();
  const { token } = await signAccessToken(JWT_SECRET, { userId: user!.id, role }, 900);
  return { user: user!, cookies: { [ACCESS_COOKIE]: token } };
}

async function makeStall(app: TestApp, slug: string) {
  const [stall] = await app.db
    .insert(stalls)
    .values({ slug, name: slug.replace('-', ' ') })
    .returning();
  return stall!;
}

async function world() {
  const app = await createTestApp();
  t = app;
  const stallA = await makeStall(app, 'stall-a');
  const stallB = await makeStall(app, 'stall-b');
  const student = await makeUser(app, 'student');
  const ownerA = await makeUser(app, 'vendor_owner');
  const staffB = await makeUser(app, 'vendor_staff');
  const admin = await makeUser(app, 'super_admin');
  await app.db.insert(stallMembers).values([
    { stallId: stallA.id, userId: ownerA.user.id, role: 'owner' },
    { stallId: stallB.id, userId: staffB.user.id, role: 'staff' },
  ]);
  return { app, stallA, stallB, student, ownerA, staffB, admin };
}

describe('authorization matrix (roles × endpoints)', () => {
  it('every caller gets exactly the access spec §3 allows', async () => {
    const w = await world();
    const endpoints = {
      myStalls: { method: 'GET', url: '/v1/vendor/stalls' },
      stallA: { method: 'GET', url: `/v1/vendor/stalls/${w.stallA.id}` },
      stallB: { method: 'GET', url: `/v1/vendor/stalls/${w.stallB.id}` },
      membersA: { method: 'GET', url: `/v1/admin/stalls/${w.stallA.id}/members` },
      registerA: {
        method: 'POST',
        url: `/v1/admin/stalls/${w.stallA.id}/members`,
        payload: { phone: '9811111111', role: 'staff' },
      },
      suspend: {
        method: 'POST',
        url: `/v1/admin/users/${w.student.user.id}/suspension`,
        payload: { suspended: false },
      },
    } as const;

    const callers = {
      anonymous: {},
      student: w.student.cookies,
      'owner of A': w.ownerA.cookies,
      'staff of B': w.staffB.cookies,
      'super admin': w.admin.cookies,
    };

    const expected: Record<keyof typeof callers, Record<keyof typeof endpoints, number>> = {
      anonymous: { myStalls: 401, stallA: 401, stallB: 401, membersA: 401, registerA: 401, suspend: 401 },
      student: { myStalls: 403, stallA: 403, stallB: 403, membersA: 403, registerA: 403, suspend: 403 },
      'owner of A': { myStalls: 200, stallA: 200, stallB: 403, membersA: 403, registerA: 403, suspend: 403 },
      'staff of B': { myStalls: 200, stallA: 403, stallB: 200, membersA: 403, registerA: 403, suspend: 403 },
      'super admin': { myStalls: 200, stallA: 200, stallB: 200, membersA: 200, registerA: 201, suspend: 204 },
    };

    const actual: Record<string, Record<string, number>> = {};
    for (const [who, cookies] of Object.entries(callers)) {
      actual[who] = {};
      for (const [name, ep] of Object.entries(endpoints)) {
        const res = await w.app.app.inject({ ...ep, cookies } as InjectOptions);
        actual[who]![name] = res.statusCode;
      }
    }
    expect(actual).toEqual(expected);
  });

  it('"my stalls" lists only the caller\'s stalls (all of them for a super admin)', async () => {
    const w = await world();
    const list = async (cookies: Record<string, string>) =>
      (await w.app.app.inject({ url: '/v1/vendor/stalls', cookies })).json().stalls as Array<{
        slug: string;
        memberRole: string | null;
      }>;
    expect(await list(w.ownerA.cookies)).toEqual([
      expect.objectContaining({ slug: 'stall-a', memberRole: 'owner' }),
    ]);
    expect(await list(w.staffB.cookies)).toEqual([
      expect.objectContaining({ slug: 'stall-b', memberRole: 'staff' }),
    ]);
    const adminSlugs = (await list(w.admin.cookies)).map((s) => s.slug);
    expect(adminSlugs).toEqual(expect.arrayContaining(['stall-a', 'stall-b']));
  });

  it('removing a stall member takes effect immediately, despite a valid token', async () => {
    const w = await world();
    const url = `/v1/vendor/stalls/${w.stallA.id}`;
    expect((await w.app.app.inject({ url, cookies: w.ownerA.cookies })).statusCode).toBe(200);
    await w.app.db
      .delete(stallMembers)
      .where(and(eq(stallMembers.stallId, w.stallA.id), eq(stallMembers.userId, w.ownerA.user.id)));
    expect((await w.app.app.inject({ url, cookies: w.ownerA.cookies })).statusCode).toBe(403);
  });

  it('outsiders get 403 for unknown stall ids too (no probing); admins get 404; bad ids 400', async () => {
    const w = await world();
    const unknown = '0190a000-0000-7000-8000-000000000000';
    expect(
      (await w.app.app.inject({ url: `/v1/vendor/stalls/${unknown}`, cookies: w.ownerA.cookies })).statusCode,
    ).toBe(403);
    expect(
      (await w.app.app.inject({ url: `/v1/vendor/stalls/${unknown}`, cookies: w.admin.cookies })).statusCode,
    ).toBe(404);
    const bad = await w.app.app.inject({ url: '/v1/vendor/stalls/not-a-uuid', cookies: w.admin.cookies });
    expect([bad.statusCode, bad.json().error.code]).toEqual([400, 'VALIDATION_ERROR']);
  });
});

/** Sign in through the real OTP flow (SMS captured by the harness). */
async function signInWithOtp(app: TestApp, phone: string) {
  await app.app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } });
  const code = app.sms.at(-1)!.body.match(/\b(\d{6})\b/)![1];
  const res = await app.app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code } });
  expect(res.statusCode).toBe(200);
  const cookie = (name: string) => res.cookies.find((c) => c.name === name)!.value;
  return { res, user: res.json().user, access: cookie(ACCESS_COOKIE), refresh: cookie(REFRESH_COOKIE) };
}

describe('pre-registered stall owners', () => {
  it('a registered number becomes vendor_owner of that stall on its first sign-in', async () => {
    const w = await world();
    const reg = await w.app.app.inject({
      method: 'POST',
      url: `/v1/admin/stalls/${w.stallA.id}/members`,
      cookies: w.admin.cookies,
      payload: { phone: '98765 22222' },
    });
    expect(reg.statusCode).toBe(201);
    expect(reg.json()).toMatchObject({ phone: '+919876522222', role: 'owner', activeNow: false });

    const pending = await w.app.app.inject({
      url: `/v1/admin/stalls/${w.stallA.id}/members`,
      cookies: w.admin.cookies,
    });
    expect(pending.json().pending).toEqual([
      expect.objectContaining({ phone: '+919876522222', role: 'owner' }),
    ]);

    const login = await signInWithOtp(w.app, '+919876522222');
    expect(login.user.role).toBe('vendor_owner');
    const mine = await w.app.app.inject({
      url: '/v1/vendor/stalls',
      cookies: { [ACCESS_COOKIE]: login.access },
    });
    expect(mine.json().stalls).toEqual([expect.objectContaining({ id: w.stallA.id, memberRole: 'owner' })]);

    const [invite] = await w.app.db
      .select()
      .from(vendorInvites)
      .where(eq(vendorInvites.phone, '+919876522222'));
    expect(invite!.acceptedAt).toBeInstanceOf(Date);
    const after = await w.app.app.inject({
      url: `/v1/admin/stalls/${w.stallA.id}/members`,
      cookies: w.admin.cookies,
    });
    expect(after.json().pending).toEqual([]);
    expect(after.json().members.map((m: { phone: string }) => m.phone)).toContain('+919876522222');
  });

  it('a staff invite gives vendor_staff; an owner invite elsewhere upgrades to vendor_owner', async () => {
    const w = await world();
    const register = (stallId: string, role: 'owner' | 'staff') =>
      w.app.app.inject({
        method: 'POST',
        url: `/v1/admin/stalls/${stallId}/members`,
        cookies: w.admin.cookies,
        payload: { phone: '9876533333', role },
      });
    await register(w.stallB.id, 'staff');
    expect((await signInWithOtp(w.app, '+919876533333')).user.role).toBe('vendor_staff');
    const second = await register(w.stallA.id, 'owner');
    expect(second.json().activeNow).toBe(true); // account exists → access right away
    const [u] = await w.app.db.select().from(users).where(eq(users.phone, '+919876533333'));
    expect(u!.role).toBe('vendor_owner');
  });

  it('registering an existing student gives access now; their next refresh carries the new role', async () => {
    const w = await world();
    const s = await signInWithOtp(w.app, '+919876544444');
    expect(s.user.role).toBe('student');
    const reg = await w.app.app.inject({
      method: 'POST',
      url: `/v1/admin/stalls/${w.stallB.id}/members`,
      cookies: w.admin.cookies,
      payload: { phone: '9876544444', role: 'owner' },
    });
    expect(reg.json().activeNow).toBe(true);
    const refreshed = await w.app.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { [REFRESH_COOKIE]: s.refresh },
    });
    expect(refreshed.json().user.role).toBe('vendor_owner');
  });

  it('registering the same number twice keeps one invite and updates the role', async () => {
    const w = await world();
    for (const role of ['owner', 'staff'] as const) {
      await w.app.app.inject({
        method: 'POST',
        url: `/v1/admin/stalls/${w.stallA.id}/members`,
        cookies: w.admin.cookies,
        payload: { phone: '9876555555', role },
      });
    }
    const rows = await w.app.db.select().from(vendorInvites).where(eq(vendorInvites.phone, '+919876555555'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role).toBe('staff');
  });

  it('rejects bad phones and unknown stalls', async () => {
    const w = await world();
    const bad = await w.app.app.inject({
      method: 'POST',
      url: `/v1/admin/stalls/${w.stallA.id}/members`,
      cookies: w.admin.cookies,
      payload: { phone: '12345' },
    });
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');
    const missing = await w.app.app.inject({
      method: 'POST',
      url: '/v1/admin/stalls/0190a000-0000-7000-8000-000000000000/members',
      cookies: w.admin.cookies,
      payload: { phone: '9876566666' },
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('super admin bootstrap', () => {
  it('a number in SUPER_ADMIN_PHONES becomes super admin when it signs in', async () => {
    t = await createTestApp({ SUPER_ADMIN_PHONES: '9876577777' });
    const s = await signInWithOtp(t, '+919876577777');
    expect(s.user.role).toBe('super_admin');
    const entries = await t.db.select().from(auditLog).where(eq(auditLog.entityId, s.user.id));
    expect(entries.map((e) => e.action)).toContain('user.role.bootstrap_super_admin');
    // and other numbers don't
    const other = await signInWithOtp(t, '+919876588888');
    expect(other.user.role).toBe('student');
  });
});

describe('suspension', () => {
  it('ends every session at once and is audited; reactivation restores sign-in', async () => {
    const w = await world();
    const s = await signInWithOtp(w.app, '+919876599999');
    const suspend = await w.app.app.inject({
      method: 'POST',
      url: `/v1/admin/users/${s.user.id}/suspension`,
      cookies: w.admin.cookies,
      payload: { suspended: true },
    });
    expect(suspend.statusCode).toBe(204);

    const refresh = await w.app.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { [REFRESH_COOKIE]: s.refresh },
    });
    expect(refresh.statusCode).toBe(401); // the session family was revoked
    expect(
      (await w.app.app.inject({ url: '/v1/me', cookies: { [ACCESS_COOKIE]: s.access } })).json().error.code,
    ).toBe('ACCOUNT_SUSPENDED');

    const [entry] = await w.app.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, s.user.id), eq(auditLog.action, 'user.suspend')));
    expect(entry).toMatchObject({
      actorId: w.admin.user.id,
      before: { status: 'active' },
      after: { status: 'suspended' },
    });

    await w.app.app.inject({
      method: 'POST',
      url: `/v1/admin/users/${s.user.id}/suspension`,
      cookies: w.admin.cookies,
      payload: { suspended: false },
    });
    const [u] = await w.app.db.select().from(users).where(eq(users.id, s.user.id));
    expect(u!.status).toBe('active');
  });

  it("an admin can't suspend themselves", async () => {
    const w = await world();
    const res = await w.app.app.inject({
      method: 'POST',
      url: `/v1/admin/users/${w.admin.user.id}/suspension`,
      cookies: w.admin.cookies,
      payload: { suspended: true },
    });
    expect([res.statusCode, res.json().error.code]).toEqual([400, 'BAD_REQUEST']);
  });
});

describe('audit log', () => {
  it('records who registered which number for which stall', async () => {
    const w = await world();
    await w.app.app.inject({
      method: 'POST',
      url: `/v1/admin/stalls/${w.stallA.id}/members`,
      cookies: w.admin.cookies,
      headers: { 'user-agent': 'audit-test' },
      payload: { phone: '9876512121' },
    });
    const [entry] = await w.app.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'stall.member.register'), eq(auditLog.entityId, w.stallA.id)));
    expect(entry).toMatchObject({
      actorId: w.admin.user.id,
      entity: 'stall',
      after: { phone: '+919876512121', role: 'owner', activeNow: false },
      ip: '127.0.0.1',
      userAgent: 'audit-test',
    });
  });
});
