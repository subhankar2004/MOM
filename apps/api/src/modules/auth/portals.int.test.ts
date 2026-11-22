import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { stallMembers, stalls, users, vendorInvites } from '../../db/schema/index.js';
import { createTestApp, type TestApp } from '../../test/test-app.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

let seq = 0;
const phone = () => `+9198${String(10_000_000 + ++seq).slice(-8)}`;

async function world() {
  const app = (t = await createTestApp({ SUPER_ADMIN_PHONES: '9898000001' }));
  const [stall] = await app.db
    .insert(stalls)
    .values({ slug: `portal-${++seq}`, name: 'Portal Stall' })
    .returning();
  const sendCode = async (p: string) => {
    const res = await app.app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone: p } });
    expect(res.statusCode).toBe(202);
    return app.sms.at(-1)!.body.match(/\b(\d{6})\b/)![1]!;
  };
  const verify = (p: string, code: string, portal?: string) =>
    app.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: { phone: p, code, ...(portal ? { portal } : {}) },
    });
  const signIn = async (p: string, portal?: string) => verify(p, await sendCode(p), portal);
  const accountOf = async (p: string) => (await app.db.select().from(users).where(eq(users.phone, p)))[0];
  return { app, stall: stall!, sendCode, verify, signIn, accountOf };
}

describe('sign-in pages (student / stall / admin)', () => {
  it('the student page lets anyone in and creates new accounts', async () => {
    const w = await world();
    const p = phone();
    const res = await w.signIn(p);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ isNewUser: true, user: { role: 'student' } });
  });

  it('the stall page refuses numbers not registered to a stall, without creating an account', async () => {
    const w = await world();
    const stranger = phone();
    const code = await w.sendCode(stranger);
    const res = await w.verify(stranger, code, 'vendor');
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatchObject({
      code: 'WRONG_PORTAL',
      message: expect.stringMatching(/isn't registered for a stall/),
    });
    expect(res.cookies).toEqual([]);
    expect(await w.accountOf(stranger)).toBeUndefined();
    // The code is used up: it can't then be used on the student page.
    expect((await w.verify(stranger, code)).json().error.code).toBe('OTP_EXPIRED');

    // An existing student account is refused too, and stays a student.
    const student = phone();
    await w.app.db.insert(users).values({ phone: student, name: 'Student' });
    expect((await w.signIn(student, 'vendor')).json().error.code).toBe('WRONG_PORTAL');
    expect((await w.accountOf(student))!.role).toBe('student');
  });

  it('lets in a stall owner registered by MOM (first sign-in) and existing stall members', async () => {
    const w = await world();
    const owner = phone();
    await w.app.db.insert(vendorInvites).values({ phone: owner, stallId: w.stall.id, role: 'owner' });
    const first = await w.signIn(owner, 'vendor');
    expect(first.statusCode).toBe(200);
    expect(first.json().user.role).toBe('vendor_owner');

    const staffPhone = phone();
    const [staff] = await w.app.db
      .insert(users)
      .values({ phone: staffPhone, name: 'Staff', role: 'vendor_staff' })
      .returning();
    await w.app.db.insert(stallMembers).values({ stallId: w.stall.id, userId: staff!.id, role: 'staff' });
    expect((await w.signIn(staffPhone, 'vendor')).statusCode).toBe(200);
  });

  it('the admin page lets in only super admins (and SUPER_ADMIN_PHONES)', async () => {
    const w = await world();
    const bootstrap = await w.signIn('+919898000001', 'admin');
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json().user.role).toBe('super_admin');

    const ownerPhone = phone();
    await w.app.db.insert(vendorInvites).values({ phone: ownerPhone, stallId: w.stall.id, role: 'owner' });
    const owner = await w.signIn(ownerPhone, 'admin');
    expect(owner.statusCode).toBe(403);
    expect(owner.json().error).toMatchObject({
      code: 'WRONG_PORTAL',
      message: "This number doesn't have admin access.",
    });
    expect(await w.accountOf(ownerPhone)).toBeUndefined();

    const adminPhone = phone();
    await w.app.db.insert(users).values({ phone: adminPhone, name: 'Admin', role: 'super_admin' });
    expect((await w.signIn(adminPhone, 'admin')).statusCode).toBe(200);
  });

  it('a wrong code on any page is just a wrong code (pages never reveal who is who)', async () => {
    const w = await world();
    const p = phone();
    await w.sendCode(p);
    const res = await w.verify(p, '000000', 'admin');
    expect(res.json().error.code).toBe('OTP_INVALID');
  });
});
