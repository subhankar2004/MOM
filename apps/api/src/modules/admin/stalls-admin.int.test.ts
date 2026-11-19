import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { auditLog, menuCategories, menuItems, stallHours, stalls, users } from '../../db/schema/index.js';
import { createTestApp, testEnv, type TestApp } from '../../test/test-app.js';
import { ACCESS_COOKIE } from '../auth/cookies.js';
import { signAccessToken, type Role } from '../auth/tokens.js';
import { PaymentGatewayError, type FakeGateway } from '../payments/gateway.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

let seq = 0;
const phone = () => `+9196${String(10_000_000 + ++seq).slice(-8)}`;

async function world() {
  const app = (t = await createTestApp());
  const login = async (role: Role) => {
    const [u] = await app.db.insert(users).values({ phone: phone(), name: role, role }).returning();
    const { token } = await signAccessToken(testEnv().JWT_SECRET, { userId: u!.id, role }, 900);
    return { id: u!.id, cookies: { [ACCESS_COOKIE]: token } };
  };
  const admin = await login('super_admin');
  const call = (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: object,
    cookies: Record<string, string> = admin.cookies,
  ) => app.app.inject({ method, url: `/v1/admin${url}`, cookies, payload });
  const gateway = app.app.paymentGateway as FakeGateway;
  return { app, admin, login, call, gateway };
}

const settlement = {
  account: {
    email: 'owner@example.com',
    phone: '98765 43210',
    legalBusinessName: 'Ravi Dosa Corner',
    businessType: 'proprietorship',
    contactName: 'Ravi Kumar',
    address: { street1: 'Near VSSUT gate', city: 'Burla', state: 'ODISHA', postalCode: '768018' },
  },
  bank: { accountNumber: '123456789012', ifsc: 'sbin0001234', beneficiaryName: 'Ravi Kumar' },
};

describe('admin stalls: access', () => {
  it('is for super admins only', async () => {
    const w = await world();
    for (const role of ['student', 'vendor_owner', 'vendor_staff'] as const) {
      const who = await w.login(role);
      expect((await w.call('GET', '/stalls', undefined, who.cookies)).statusCode).toBe(403);
      expect((await w.call('POST', '/stalls', { name: 'Sneaky' }, who.cookies)).statusCode).toBe(403);
    }
  });
});

describe('admin stalls: create, register the owner, sign in (acceptance)', () => {
  it("an admin creates a stall and registers a phone; that phone signs in to the stall's console", async () => {
    const w = await world();
    const created = await w.call('POST', '/stalls', { name: 'Ravi’s Dosa Corner', location: 'Library gate' });
    expect(created.statusCode).toBe(201);
    const { id, slug } = created.json();
    expect(slug).toBe('ravi-s-dosa-corner');
    // Same name again gets a free web address.
    expect((await w.call('POST', '/stalls', { name: 'Ravi’s Dosa Corner' })).json().slug).toBe(
      'ravi-s-dosa-corner-2',
    );

    const owner = '98765 11111';
    const reg = await w.call('POST', `/stalls/${id}/members`, { phone: owner });
    expect(reg.statusCode).toBe(201);
    const detail = (await w.call('GET', `/stalls/${id}`)).json();
    expect(detail.stall).toMatchObject({
      name: 'Ravi’s Dosa Corner',
      status: 'draft',
      location: 'Library gate',
    });
    expect(detail.pending).toEqual([expect.objectContaining({ phone: '+919876511111', role: 'owner' })]);
    expect(detail.checklist.owner).toBe(true);

    // The owner signs in with an OTP (as on their phone).
    await w.app.app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone: owner } });
    const code = w.app.sms.at(-1)!.body.match(/\b(\d{6})\b/)![1];
    const signedIn = await w.app.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: { phone: owner, code },
    });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json().user.role).toBe('vendor_owner');
    const access = signedIn.cookies.find((c) => c.name === ACCESS_COOKIE)!.value;
    const mine = await w.app.app.inject({ url: '/v1/vendor/stalls', cookies: { [ACCESS_COOKIE]: access } });
    expect(mine.json().stalls).toEqual([expect.objectContaining({ id, memberRole: 'owner' })]);
    // ...and can open its menu editor.
    const menu = await w.app.app.inject({
      url: `/v1/vendor/stalls/${id}/menu`,
      cookies: { [ACCESS_COOKIE]: access },
    });
    expect(menu.statusCode).toBe(200);

    const audits = await w.app.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'stall.create')));
    expect(audits).toHaveLength(1);
  });

  it('validates names and web addresses', async () => {
    const w = await world();
    expect((await w.call('POST', '/stalls', { name: 'X' })).statusCode).toBe(400);
    expect((await w.call('POST', '/stalls', { name: 'Good name', slug: 'Bad Slug!' })).statusCode).toBe(400);
    const a = (await w.call('POST', '/stalls', { name: 'Chai Point', slug: 'chai' })).json();
    expect((await w.call('POST', '/stalls', { name: 'Other', slug: 'chai' })).statusCode).toBe(409);
    const b = (await w.call('POST', '/stalls', { name: 'Other' })).json();
    expect((await w.call('PATCH', `/stalls/${b.id}`, { slug: 'chai' })).statusCode).toBe(409);
    expect((await w.call('PATCH', `/stalls/${a.id}`, { slug: 'chai-point' })).json().stall.slug).toBe(
      'chai-point',
    );
  });

  it('lists and searches stalls with their checklist', async () => {
    const w = await world();
    await w.call('POST', '/stalls', { name: 'Momo Hut' });
    await w.call('POST', '/stalls', { name: 'Juice Bar' });
    const all = (await w.call('GET', '/stalls?q=momo')).json().stalls;
    expect(all.map((s: { name: string }) => s.name)).toEqual(['Momo Hut']);
    expect(all[0].checklist).toEqual({
      menu: false,
      hours: false,
      photo: false,
      payments: true,
      owner: false,
    });
    expect((await w.call('GET', '/stalls?q=%25')).json().stalls).toEqual([]);
  });
});

describe('admin stalls: go live and suspend', () => {
  it('goes live only with the whole checklist, and can be suspended', async () => {
    const w = await world();
    const { id, slug } = (await w.call('POST', '/stalls', { name: 'Go Live Stall' })).json();
    const early = await w.call('PATCH', `/stalls/${id}`, { status: 'active' });
    expect(early.statusCode).toBe(409);
    expect(early.json().error).toMatchObject({
      message:
        "Before going live, add a dish on the menu, opening hours, a stall photo and the owner's phone number.",
      details: { missing: ['menu', 'hours', 'photo', 'owner'] },
    });

    const [cat] = await w.app.db.insert(menuCategories).values({ stallId: id, name: 'Food' }).returning();
    await w.app.db
      .insert(menuItems)
      .values({ stallId: id, categoryId: cat!.id, name: 'Dosa', pricePaise: 6000, isVeg: true });
    await w.app.db
      .insert(stallHours)
      .values({ stallId: id, weekday: 1, opensAt: '08:00', closesAt: '20:00' });
    await w.app.db
      .update(stalls)
      .set({ photoKey: `stalls/${id}/cover/x.webp` })
      .where(eq(stalls.id, id));
    await w.call('POST', `/stalls/${id}/members`, { phone: '98765 22222' });

    const live = await w.call('PATCH', `/stalls/${id}`, { status: 'active' });
    expect(live.statusCode).toBe(200);
    expect(live.json().stall.status).toBe('active');
    expect((await w.app.app.inject({ url: `/v1/stalls/${slug}` })).statusCode).toBe(200);

    await w.call('PATCH', `/stalls/${id}`, { status: 'suspended' });
    expect((await w.app.app.inject({ url: `/v1/stalls/${slug}` })).statusCode).toBe(404);
    const audits = await w.app.db.select().from(auditLog).where(eq(auditLog.entityId, id));
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(['stall.status.active', 'stall.status.suspended']),
    );
  });
});

describe('admin stalls: settlement account (Razorpay Route)', () => {
  it('creates the linked account, never stores bank details, and turns active on refresh', async () => {
    const w = await world();
    const { id } = (await w.call('POST', '/stalls', { name: 'Route Stall' })).json();
    const res = await w.call('POST', `/stalls/${id}/settlement-account`, settlement);
    expect(res.statusCode).toBe(200);
    expect(res.json().stall).toMatchObject({
      routeStatus: 'pending',
      razorpayAccountId: expect.stringMatching(/^acc_fake/),
    });

    const sent = w.gateway.accounts.get(res.json().stall.razorpayAccountId)!;
    expect(sent.input).toMatchObject({ phone: '9876543210', businessType: 'proprietorship' });
    expect(sent.bank).toEqual({
      accountNumber: '123456789012',
      ifsc: 'SBIN0001234',
      beneficiaryName: 'Ravi Kumar',
    });

    // MOM keeps only the masked number in the audit log, nowhere the full one.
    const audits = await w.app.db.select().from(auditLog).where(eq(auditLog.entityId, id));
    expect(JSON.stringify(audits)).not.toContain('123456789012');
    expect(JSON.stringify(audits)).toContain('XXXX9012');
    const [row] = await w.app.db.select().from(stalls).where(eq(stalls.id, id));
    expect(JSON.stringify(row)).not.toContain('123456789012');

    const refreshed = await w.call('POST', `/stalls/${id}/settlement-account/refresh`);
    expect(refreshed.json().stall.routeStatus).toBe('activated');
    // Already active: no second account.
    expect((await w.call('POST', `/stalls/${id}/settlement-account`, settlement)).statusCode).toBe(409);
  });

  it('resumes a half-finished setup instead of creating a second account', async () => {
    const w = await world();
    const { id } = (await w.call('POST', '/stalls', { name: 'Retry Stall' })).json();
    // Account and stakeholder are created, then Razorpay refuses the Route request.
    const original = w.gateway.requestRoute.bind(w.gateway);
    let failOnce = true;
    w.gateway.requestRoute = async (accountId: string) => {
      if (failOnce) {
        failOnce = false;
        throw new PaymentGatewayError('Invalid IFSC Code.', 400);
      }
      return original(accountId);
    };
    const first = await w.call('POST', `/stalls/${id}/settlement-account`, settlement);
    expect(first.statusCode).toBe(400);
    expect(first.json().error.message).toBe('Razorpay: Invalid IFSC Code.');

    const second = await w.call('POST', `/stalls/${id}/settlement-account`, settlement);
    expect(second.statusCode).toBe(200);
    expect(w.gateway.accounts.size).toBe(1);
    expect([...w.gateway.accounts.values()][0]!.stakeholders).toBe(1);
  });

  it('validates the bank details before calling Razorpay', async () => {
    const w = await world();
    const { id } = (await w.call('POST', '/stalls', { name: 'Bad Bank Stall' })).json();
    const bad = await w.call('POST', `/stalls/${id}/settlement-account`, {
      ...settlement,
      bank: { ...settlement.bank, ifsc: 'SBIN1234' },
    });
    expect(bad.statusCode).toBe(400);
    expect(w.gateway.accounts.size).toBe(0);
  });

  it('can mark the account active with test keys only', async () => {
    const w = await world();
    const { id } = (await w.call('POST', '/stalls', { name: 'Test Mode Stall' })).json();
    expect((await w.call('GET', `/stalls/${id}`)).json().canTestActivate).toBe(true);
    const res = await w.call('POST', `/stalls/${id}/settlement-account/test-activate`);
    expect(res.json().stall.routeStatus).toBe('activated');
  });
});
