import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditLog,
  ledgerEntries,
  orders,
  payments,
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
  const call = (method: 'GET' | 'POST', url: string, payload?: object, cookies = admin.cookies) =>
    app.app.inject({ method, url: `/v1/admin${url}`, cookies, payload });
  const gateway = app.app.paymentGateway as FakeGateway;
  return { app, stall, otherStall, student, vendor, admin, place, pay, act, call, gateway };
}

type Overview = {
  today: Record<string, number>;
  live: Record<string, number>;
  reconciliation: { status: string } | null;
};
const diff = (after: Record<string, number>, before: Record<string, number>) =>
  Object.fromEntries(Object.keys(after).map((k) => [k, after[k]! - before[k]!]));
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * A hand-computed day (2 × ₹60 = ₹120 subtotal per order; platform fee 1% = ₹1.20,
 * cash fee 5% = ₹6.00):
 *   u1 UPI, paid, handed over          → +120
 *   u2 UPI, paid, rejected → refunded  → +120 −120
 *   c1 cash, handed over with cash     → +120 +600
 *   c2 cash, still waiting             → 0
 *   u3 UPI, never paid                 → 0
 *   adjustment: MOM gives back ₹1.00   → −100
 */
async function scenario(w: Awaited<ReturnType<typeof world>>) {
  const u1 = await w.place('upi');
  await w.pay(u1.id);
  await w.act(u1.id, 'handover', {});
  const u2 = await w.place('upi');
  await w.pay(u2.id);
  await w.act(u2.id, 'reject', { reason: 'Out of batter' });
  const c1 = await w.place('cash');
  await w.act(c1.id, 'handover', { cashReceived: true });
  const c2 = await w.place('cash');
  const u3 = await w.place('upi');
  const adj = await w.call('POST', '/ledger/adjustments', {
    stallId: w.stall.id,
    direction: 'debit',
    amountPaise: 100,
    note: 'Goodwill for a late order',
  });
  expect(adj.statusCode).toBe(201);
  return { u1, u2, c1, c2, u3 };
}

describe('admin overview and revenue (acceptance: match a hand-computed day)', () => {
  it('overview: today’s orders, value, MOM revenue and live orders', async () => {
    const w = await world();
    const before = (await w.call('GET', '/overview')).json() as Overview;
    await scenario(w);
    const after = (await w.call('GET', '/overview')).json() as Overview;
    expect(diff(after.today, before.today)).toEqual({
      orders: 4, // u1, u2, c1, c2 got tokens; u3 never did
      collected: 2,
      upiOrders: 2,
      cashOrders: 2,
      orderValuePaise: 12120 + 12720 + 12720, // rejected u2 doesn't count
      revenuePaise: 120 + (120 - 120) + 720 - 100,
      failedPayments: 0,
    });
    expect(diff(after.live, before.live)).toEqual({ placed: 1, preparing: 0, ready: 0 });
  });

  it('revenue: totals, per-stall commission and UPI/cash mix from the ledger', async () => {
    const w = await world();
    const day = today();
    const before = (await w.call('GET', `/revenue?from=${day}&to=${day}`)).json();
    await scenario(w);
    const after = (await w.call('GET', `/revenue?from=${day}&to=${day}`)).json();
    expect(diff(after.totals, before.totals)).toEqual({
      platformFeesPaise: 360,
      cashFeesPaise: 600,
      refundedPaise: 120,
      adjustmentsPaise: -100,
      netPaise: 740,
    });
    expect(after.byStall.find((s: { stallId: string }) => s.stallId === w.stall.id)).toEqual({
      stallId: w.stall.id,
      stallName: 'Board Stall',
      orders: 2,
      orderValuePaise: 12120 + 12720,
      platformFeesPaise: 360,
      cashFeesPaise: 600,
      refundedPaise: 120,
      netPaise: 740,
    });
    expect(after.mix.upi.orders - before.mix.upi.orders).toBe(1);
    expect(after.mix.cash.valuePaise - before.mix.cash.valuePaise).toBe(12720);
    expect(after.series).toHaveLength(1);
    expect(after.series[0].netPaise - before.series[0].netPaise).toBe(740);
  });

  it('groups by week and month with every bucket, and checks the dates', async () => {
    const w = await world();
    const weeks = (await w.call('GET', '/revenue?from=2026-11-01&to=2026-11-30&group=week')).json();
    // 26 Oct (Mon) … 30 Nov: six Monday-started weeks touch November 2026.
    expect(weeks.series.map((s: { bucket: string }) => s.bucket)).toEqual([
      '2026-10-26',
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30',
    ]);
    const months = (await w.call('GET', '/revenue?from=2026-01-15&to=2026-03-01&group=month')).json();
    expect(months.series.map((s: { bucket: string }) => s.bucket)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ]);
    expect((await w.call('GET', '/revenue?from=2026-03-01&to=2026-01-01')).statusCode).toBe(400);
    expect((await w.call('GET', '/revenue?from=2024-01-01&to=2026-01-01')).statusCode).toBe(400);
    expect((await w.call('GET', '/revenue?group=year')).statusCode).toBe(400);
    expect((await w.call('GET', '/overview', undefined, w.vendor.cookies)).statusCode).toBe(403);
  });
});

describe('reconciliation (acceptance: flags a deliberately broken order)', () => {
  it('finds nothing wrong with a healthy day', async () => {
    const w = await world();
    const ids = Object.values(await scenario(w)).map((o) => o.id);
    const res = await w.call('POST', '/reconciliation/run', { days: 1 });
    expect(res.statusCode).toBe(200);
    const mine = res.json().run.issues.filter((i: { orderId: string }) => ids.includes(i.orderId));
    expect(mine).toEqual([]);
  });

  it('flags missing fees, a wrong payment amount and a stuck refund', async () => {
    const w = await world();
    const { c2, u1 } = await scenario(w);
    // Broken on purpose: cash marked received without the hand-over (so no fees in the ledger)...
    await w.app.db.update(orders).set({ paymentStatus: 'paid_cash' }).where(eq(orders.id, c2.id));
    // ...Razorpay captured less than the order total...
    await w.app.db.update(payments).set({ amountPaise: 100 }).where(eq(payments.orderId, u1.id));
    // ...and a refund that couldn't start two days ago.
    const stuck = await w.place('upi');
    await w.pay(stuck.id);
    await w.app.db
      .update(orders)
      .set({
        status: 'cancelled',
        paymentStatus: 'refund_pending',
        updatedAt: new Date(Date.now() - 2 * 86_400_000),
      })
      .where(eq(orders.id, stuck.id));

    const { run } = (await w.call('POST', '/reconciliation/run', { days: 1 })).json();
    expect(run.status).toBe('mismatch');
    const kinds = (orderId: string) =>
      run.issues
        .filter((i: { orderId: string }) => i.orderId === orderId)
        .map((i: { kind: string }) => i.kind)
        .sort();
    expect(kinds(c2.id)).toEqual(['cash_state', 'ledger_mismatch']);
    expect(
      run.issues.find(
        (i: { orderId: string; kind: string }) => i.orderId === c2.id && i.kind === 'ledger_mismatch',
      ),
    ).toMatchObject({
      severity: 'error',
      expectedPaise: 720,
      actualPaise: 0,
    });
    expect(kinds(u1.id)).toEqual(['payment_amount']);
    expect(kinds(stuck.id)).toEqual(['refund_stuck']);

    // Stored, and the overview shows it.
    const runs = (await w.call('GET', '/reconciliation')).json().runs;
    expect(runs[0].id).toBe(run.id);
    expect((await w.call('GET', '/overview')).json().reconciliation).toMatchObject({ status: 'mismatch' });
  });

  it('flags a ledger entry booked to the wrong stall', async () => {
    const w = await world();
    const o = await w.place('cash');
    await w.act(o.id, 'handover', { cashReceived: true });
    await w.app.db.insert(ledgerEntries).values({
      stallId: w.otherStall.id,
      orderId: o.id,
      entryType: 'adjustment',
      direction: 'credit',
      amountPaise: 50,
    });
    const { run } = (await w.call('POST', '/reconciliation/run', { days: 1 })).json();
    expect(
      run.issues.filter((i: { orderId: string }) => i.orderId === o.id).map((i: { kind: string }) => i.kind),
    ).toEqual(['ledger_wrong_stall']);
  });

  it('adjustments are validated and audited', async () => {
    const w = await world();
    const bad = await w.call('POST', '/ledger/adjustments', {
      stallId: w.stall.id,
      direction: 'debit',
      amountPaise: 0,
      note: 'x',
    });
    expect(bad.statusCode).toBe(400);
    const res = await w.call('POST', '/ledger/adjustments', {
      stallId: w.stall.id,
      direction: 'credit',
      amountPaise: 250,
      note: 'Cash fee missed on a paper order',
    });
    const audits = await w.app.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'ledger.adjustment'), eq(auditLog.entityId, w.stall.id)));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.after).toMatchObject({ ledgerEntryId: res.json().id, amountPaise: 250 });
  });
});
