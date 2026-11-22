import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditLog,
  menuCategories,
  menuItems,
  platformSettings,
  stallMembers,
  stalls,
  users,
} from '../../db/schema/index.js';
import { createTestApp, testEnv, type TestApp } from '../../test/test-app.js';
import { ACCESS_COOKIE } from '../auth/cookies.js';
import { signAccessToken, type Role } from '../auth/tokens.js';
import type { FakeGateway } from '../payments/gateway.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

let seq = 0;
const phone = () => `+9193${String(10_000_000 + ++seq).slice(-8)}`;

async function world() {
  const app = (t = await createTestApp({}, { now: () => new Date() }));
  await app.db.insert(platformSettings).values({
    platformFeeBps: 100,
    cashFeeBps: 500,
    maxOpenCashOrders: 20,
    cashStrikeLimit: 3,
    orderExpiryMinutes: 15,
    congestionLowMaxMinutes: 10,
    congestionModerateMaxMinutes: 20,
  });
  const mkStall = async (slug: string) =>
    (
      await app.db
        .insert(stalls)
        .values({
          slug: `${slug.toLowerCase().replace(/ /g, '-')}-${++seq}`,
          name: slug,
          status: 'active',
          isOpenOverride: true,
          upiEnabled: true,
          routeStatus: 'activated',
        })
        .returning()
    )[0]!;
  const stall = await mkStall('Board Stall');
  const otherStall = await mkStall('Other Stall');
  const [cat] = await app.db.insert(menuCategories).values({ stallId: stall.id, name: 'Food' }).returning();
  const [dosa] = await app.db
    .insert(menuItems)
    .values({ stallId: stall.id, categoryId: cat!.id, name: 'Masala Dosa', pricePaise: 6000, isVeg: true })
    .returning();

  const cookiesFor = async (role: Role, stallId?: string) => {
    const [u] = await app.db.insert(users).values({ phone: phone(), name: role, role }).returning();
    if (stallId) await app.db.insert(stallMembers).values({ stallId, userId: u!.id, role: 'owner' });
    const { token } = await signAccessToken(testEnv().JWT_SECRET, { userId: u!.id, role }, 900);
    return { id: u!.id, cookies: { [ACCESS_COOKIE]: token } };
  };
  const student = await cookiesFor('student');
  const vendor = await cookiesFor('vendor_owner', stall.id);

  const place = async (method: 'cash' | 'upi' = 'cash', note?: string) => {
    const res = await app.app.inject({
      method: 'POST',
      url: '/v1/orders',
      cookies: student.cookies,
      headers: { 'idempotency-key': `board-key-${++seq}-abc` },
      payload: {
        stallId: stall.id,
        items: [{ itemId: dosa!.id, quantity: 2 }],
        paymentMethod: method,
        expectedTotalPaise: method === 'cash' ? 12720 : 12120,
        note,
      },
    });
    return res.json().order as { id: string; tokenNo: number | null };
  };
  const pay = async (orderId: string) => {
    const start = await app.app.inject({
      method: 'POST',
      url: '/v1/payments/razorpay/order',
      cookies: student.cookies,
      payload: { orderId },
    });
    const rzp = start.json().razorpayOrderId as string;
    const paymentId = `pay_${++seq}`;
    await app.app.inject({
      method: 'POST',
      url: '/v1/payments/razorpay/verify',
      cookies: student.cookies,
      payload: {
        orderId,
        razorpayOrderId: rzp,
        razorpayPaymentId: paymentId,
        razorpaySignature: createHmac('sha256', testEnv().RAZORPAY_KEY_SECRET!)
          .update(`${rzp}|${paymentId}`)
          .digest('hex'),
      },
    });
    return paymentId;
  };
  const act = (orderId: string, action: string, body?: object, cookies = vendor.cookies) =>
    app.app.inject({
      method: 'POST',
      url: `/v1/vendor/stalls/${stall.id}/orders/${orderId}/${action}`,
      cookies,
      ...(body ? { payload: body } : {}),
    });
  const staff = await cookiesFor('vendor_staff');
  await app.db.insert(stallMembers).values({ stallId: stall.id, userId: staff.id, role: 'staff' });
  const admin = await cookiesFor('super_admin');
  const call = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object, cookies = admin.cookies) =>
    app.app.inject({ method, url: `/v1/admin${url}`, cookies, payload });
  const gateway = app.app.paymentGateway as FakeGateway;
  return { app, stall, otherStall, student, vendor, admin, place, pay, act, call, gateway };
}

/** The settings form as it is now, with some fields changed. */
async function form(w: Awaited<ReturnType<typeof world>>, changes: Record<string, unknown>) {
  const { current } = (await w.call('GET', '/settings')).json();
  const { id: _id, effectiveFrom: _from, ...values } = current;
  return { ...values, ...changes };
}

async function placeAt(
  w: Awaited<ReturnType<typeof world>>,
  method: 'cash' | 'upi',
  expectedTotalPaise: number,
) {
  const dosa = (await w.app.app.inject({ url: `/v1/stalls/${w.stall.slug}/menu` })).json().categories[0]
    .items[0];
  return w.app.app.inject({
    method: 'POST',
    url: '/v1/orders',
    cookies: w.student.cookies,
    headers: { 'idempotency-key': `settings-${Date.now()}-${Math.random()}` },
    payload: {
      stallId: w.stall.id,
      items: [{ itemId: dosa.id, quantity: 2 }],
      paymentMethod: method,
      expectedTotalPaise,
    },
  });
}

describe('platform settings (acceptance: a fee change affects only new orders)', () => {
  it('raising the platform fee leaves placed orders alone and applies to the next one', async () => {
    const w = await world();
    const before = await w.place('cash'); // 1%: ₹120 + ₹1.20 + ₹6.00 = ₹127.20

    const saved = await w.call('POST', '/settings', await form(w, { platformFeeBps: 200 }));
    expect(saved.statusCode).toBe(201);

    // The order placed before keeps its fee.
    const old = (
      await w.app.app.inject({ url: `/v1/orders/${before.id}`, cookies: w.student.cookies })
    ).json().order;
    expect(old).toMatchObject({ platformFeeBps: 100, platformFeePaise: 120, totalPaise: 12720 });

    // A checkout still showing the old total is refused with the new bill...
    const stale = await placeAt(w, 'cash', 12720);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('CART_CHANGED');
    // ...and the next order pays 2%: ₹120 + ₹2.40 + ₹6.00 = ₹128.40.
    const fresh = await placeAt(w, 'cash', 12840);
    expect(fresh.statusCode).toBe(201);
    expect(fresh.json().order).toMatchObject({
      platformFeeBps: 200,
      platformFeePaise: 240,
      totalPaise: 12840,
    });
  });

  it('every change is audited with only what changed; scheduled changes wait and can be cancelled', async () => {
    const w = await world();
    await w.call('POST', '/settings', await form(w, { cashFeeBps: 400, orderExpiryMinutes: 10 }));
    const later = new Date(Date.now() + 3_600_000).toISOString();
    const scheduled = await w.call(
      'POST',
      '/settings',
      await form(w, { platformFeeBps: 300, effectiveFrom: later }),
    );
    expect(scheduled.statusCode).toBe(201);
    const overview = (await w.call('GET', '/settings')).json();
    expect(overview.current).toMatchObject({ platformFeeBps: 100, cashFeeBps: 400, orderExpiryMinutes: 10 });
    expect(overview.scheduled).toHaveLength(1);
    expect(overview.scheduled[0].platformFeeBps).toBe(300);

    // Nothing else can be saved while a change waits (it would undo it later).
    const blocked = await w.call('POST', '/settings', await form(w, { cashStrikeLimit: 5 }));
    expect(blocked.statusCode).toBe(409);
    expect((await w.call('DELETE', `/settings/${overview.scheduled[0].id}`)).statusCode).toBe(204);
    expect((await w.call('DELETE', `/settings/${overview.current.id}`)).statusCode).toBe(404); // in force: can't cancel

    const audits = await w.app.db
      .select({
        action: auditLog.action,
        before: auditLog.before,
        after: auditLog.after,
        actorId: auditLog.actorId,
      })
      .from(auditLog)
      .where(eq(auditLog.entity, 'platform_settings'));
    const mine = audits.filter((a) => a.actorId === w.admin.id);
    expect(mine.map((a) => a.action)).toEqual([
      'platform.settings.change',
      'platform.settings.schedule',
      'platform.settings.cancel_scheduled',
    ]);
    expect(mine[0]!.before).toEqual({ cashFeeBps: 500, orderExpiryMinutes: 15 });
    expect(mine[0]!.after).toMatchObject({ cashFeeBps: 400, orderExpiryMinutes: 10 });
  });

  it('validates the form and is for super admins only', async () => {
    const w = await world();
    expect((await w.call('POST', '/settings', await form(w, {}))).json().error.message).toBe(
      'Nothing changed',
    );
    expect(
      (
        await w.call(
          'POST',
          '/settings',
          await form(w, { congestionLowMaxMinutes: 30, congestionModerateMaxMinutes: 20 }),
        )
      ).statusCode,
    ).toBe(400);
    expect((await w.call('POST', '/settings', await form(w, { platformFeeBps: 2500 }))).statusCode).toBe(400);
    expect((await w.call('GET', '/settings', undefined, w.vendor.cookies)).statusCode).toBe(403);
  });
});

describe('global switches', () => {
  it('cash off for every stall: hidden at checkout, refused on order, explained to the stall', async () => {
    const w = await world();
    await w.call('POST', '/settings', await form(w, { cashEnabledGlobally: false }));
    const stall = (await w.app.app.inject({ url: `/v1/stalls/${w.stall.slug}` })).json().stall;
    expect(stall.payments.cash).toBe(false);
    const dosa = (await w.app.app.inject({ url: `/v1/stalls/${w.stall.slug}/menu` })).json().categories[0]
      .items[0];
    const quote = (
      await w.app.app.inject({
        method: 'POST',
        url: '/v1/cart/quote',
        payload: { stallId: w.stall.id, items: [{ itemId: dosa.id, quantity: 1, pricePaise: 6000 }] },
      })
    ).json();
    expect(quote.options.cash).toBeNull();
    expect((await placeAt(w, 'cash', 12720)).json().error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
    const settings = (
      await w.app.app.inject({ url: `/v1/vendor/stalls/${w.stall.id}/settings`, cookies: w.vendor.cookies })
    ).json();
    expect(settings.platform).toEqual({ cashEnabled: false, orderingPaused: false });
    expect(settings.settings).toMatchObject({ cashEnabled: true, payments: { cash: false } });
  });

  it('ordering paused: every stall shows paused and orders are refused', async () => {
    const w = await world();
    await w.call('POST', '/settings', await form(w, { orderingPaused: true }));
    expect(
      (await w.app.app.inject({ url: `/v1/stalls/${w.stall.slug}` })).json().stall.availability.state,
    ).toBe('paused');
    const res = await placeAt(w, 'cash', 12720);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/paused ordering/);
    await w.call('POST', '/settings', await form(w, { orderingPaused: false }));
    expect((await placeAt(w, 'cash', 12720)).statusCode).toBe(201);
  });
});

describe('audit log viewer', () => {
  it('filters by who, entity, record, action and date, newest first, with pagination', async () => {
    const w = await world();
    const o = await w.place('cash');
    await w.act(o.id, 'accept');
    await w.call('POST', '/settings', await form(w, { cashStrikeLimit: 4 }));

    const byRecord = (await w.call('GET', `/audit?entity=order&entityId=${o.id}`)).json().entries;
    expect(byRecord.map((e: { action: string }) => e.action)).toEqual(['order.accept']);
    expect(byRecord[0].actor).toMatchObject({ id: w.vendor.id, name: 'vendor_owner' });

    const settings = (await w.call('GET', '/audit?action=platform.settings&actor=super_admin')).json()
      .entries;
    expect(settings[0]).toMatchObject({
      action: 'platform.settings.change',
      before: { cashStrikeLimit: 3 },
      after: { cashStrikeLimit: 4 },
    });

    const page1 = (await w.call('GET', `/audit?entityId=${o.id}&limit=1`)).json();
    expect(page1.entries).toHaveLength(1);
    expect(page1.nextBefore).toBeNull();
    expect((await w.call('GET', '/audit?from=2026-02-02&to=2026-02-01')).statusCode).toBe(400);
    expect((await w.call('GET', '/audit', undefined, w.vendor.cookies)).statusCode).toBe(403);
  });
});
