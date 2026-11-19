import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditLog,
  ledgerEntries,
  orders,
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
import { PaymentGatewayError, type FakeGateway } from '../payments/gateway.js';

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

const orderAudits = (app: TestApp, orderId: string) =>
  app.db
    .select({ action: auditLog.action, actorId: auditLog.actorId })
    .from(auditLog)
    .where(and(eq(auditLog.entity, 'order'), eq(auditLog.entityId, orderId)));

describe('admin orders: explorer', () => {
  it('is for super admins only', async () => {
    const w = await world();
    expect((await w.call('GET', '/orders', undefined, w.vendor.cookies)).statusCode).toBe(403);
    expect((await w.call('GET', '/orders', undefined, w.student.cookies)).statusCode).toBe(403);
  });

  it('searches by token, order id, phone or name and filters by status and payment', async () => {
    const w = await world();
    const cash = await w.place('cash');
    const upi = await w.place('upi');
    await w.pay(upi.id);
    const [me] = await w.app.db.select().from(users).where(eq(users.id, w.student.id));

    const ids = async (query: string) =>
      (await w.call('GET', `/orders${query}`)).json().orders.map((o: { id: string }) => o.id);
    expect(await ids(`?q=%23${cash.tokenNo}&stallId=${w.stall.id}`)).toEqual([cash.id]);
    expect(await ids(`?q=${upi.id}`)).toEqual([upi.id]);
    expect(await ids(`?q=${me!.phone!.slice(-10)}&stallId=${w.stall.id}`)).toEqual([upi.id, cash.id]);
    expect(await ids(`?stallId=${w.stall.id}&paymentMethod=cash`)).toEqual([cash.id]);
    expect(await ids(`?stallId=${w.stall.id}&paymentStatus=paid`)).toEqual([upi.id]);
    expect(await ids(`?stallId=${w.stall.id}&status=collected`)).toEqual([]);
    const page = (await w.call('GET', `/orders?stallId=${w.stall.id}&limit=1`)).json();
    expect(page.orders).toHaveLength(1);
    expect(page.orders[0]).toMatchObject({ stall: { name: 'Board Stall' }, student: { id: w.student.id } });
    expect(await ids(`?stallId=${w.stall.id}&limit=1&before=${page.nextBefore}`)).toHaveLength(1);
    expect((await w.call('GET', '/orders?from=2026-02-10&to=2026-02-01')).statusCode).toBe(400);
  });

  it('shows the order with items, payments and a timeline of who did what', async () => {
    const w = await world();
    const o = await w.place('upi');
    await w.pay(o.id);
    await w.act(o.id, 'accept');
    await w.act(o.id, 'ready');
    await w.act(o.id, 'handover', {});
    const d = (await w.call('GET', `/orders/${o.id}`)).json();
    expect(d.order).toMatchObject({ status: 'collected', paymentStatus: 'paid', subtotalPaise: 12000 });
    expect(d.items).toEqual([
      { name: 'Masala Dosa', quantity: 2, unitPricePaise: 6000, lineTotalPaise: 12000 },
    ]);
    expect(d.payments).toHaveLength(1);
    const labels = d.timeline.map((e: { label: string }) => e.label);
    // (In tests every audit row shares one transaction's timestamp, so only check the
    // audited steps' order here; in production each step is its own transaction.)
    expect(labels.filter((l: string) => l !== 'Paid by UPI, token issued')).toEqual([
      'Order placed',
      'Accepted by the stall',
      'Marked ready',
      'Handed over',
    ]);
    expect(labels).toContain('Paid by UPI, token issued');
    expect(d.timeline.find((e: { label: string }) => e.label === 'Accepted by the stall').by).toBe(
      'vendor_owner',
    );
    expect(d.can).toEqual({ cancel: false, refund: true });
  });
});

describe('admin orders: cancel and refund', () => {
  it('cancels a cash order with a reason, audited; a second cancel is refused', async () => {
    const w = await world();
    const o = await w.place('cash');
    const res = await w.call('POST', `/orders/${o.id}/cancel`, { reason: 'Stall closed early' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      order: { status: 'cancelled', reason: 'Stall closed early' },
      refund: 'none',
    });
    expect(res.json().timeline.at(-1)).toMatchObject({ label: 'Cancelled by MOM: “Stall closed early”' });
    expect((await w.call('POST', `/orders/${o.id}/cancel`, { reason: 'again' })).statusCode).toBe(409);
    expect((await w.call('POST', `/orders/${o.id}/cancel`, { reason: 'x' })).statusCode).toBe(400);
    expect(await orderAudits(w.app, o.id)).toContainEqual({
      action: 'order.cancel_by_admin',
      actorId: w.admin.id,
    });
  });

  it('cancelling a paid UPI order refunds it and reverses MOM’s fee', async () => {
    const w = await world();
    const o = await w.place('upi');
    await w.pay(o.id);
    const res = (await w.call('POST', `/orders/${o.id}/cancel`, { reason: 'Kitchen fire drill' })).json();
    expect(res).toMatchObject({
      refund: 'started',
      order: { status: 'cancelled', paymentStatus: 'refunded' },
    });
    expect(w.gateway.refunds).toHaveLength(1);
    const ledger = await w.app.db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, o.id));
    expect(ledger.map((l) => [l.entryType, l.direction, l.amountPaise])).toEqual([
      ['platform_fee', 'credit', 120],
      ['refund_reversal', 'debit', 120],
    ]);
    expect((await orderAudits(w.app, o.id)).map((a) => a.action)).toEqual(
      expect.arrayContaining(['order.cancel_by_admin', 'order.refund']),
    );
  });

  it('if Razorpay is down the order is cancelled as refund_pending, and the refund can be retried', async () => {
    const w = await world();
    const o = await w.place('upi');
    await w.pay(o.id);
    const original = w.gateway.refund.bind(w.gateway);
    w.gateway.refund = async () => {
      throw new PaymentGatewayError('Razorpay unreachable', 503);
    };
    const res = (await w.call('POST', `/orders/${o.id}/cancel`, { reason: 'Stall closed' })).json();
    expect(res).toMatchObject({
      refund: 'retry_later',
      order: { status: 'cancelled', paymentStatus: 'refund_pending' },
    });
    expect(res.can.refund).toBe(true);

    // Still down: a clear error, nothing changes.
    expect((await w.call('POST', `/orders/${o.id}/refund`, { reason: 'Retry' })).statusCode).toBe(503);
    w.gateway.refund = original;
    const retried = await w.call('POST', `/orders/${o.id}/refund`, { reason: 'Retry' });
    expect(retried.json().order.paymentStatus).toBe('refunded');
    expect((await w.call('POST', `/orders/${o.id}/refund`, { reason: 'Retry' })).statusCode).toBe(409);
  });

  it('refunds a collected UPI order; refuses open, cash and unknown orders', async () => {
    const w = await world();
    const o = await w.place('upi');
    await w.pay(o.id);
    expect(
      (await w.call('POST', `/orders/${o.id}/refund`, { reason: 'Complaint' })).json().error.message,
    ).toMatch(/Cancel it instead/);
    await w.act(o.id, 'handover', {});
    const res = await w.call('POST', `/orders/${o.id}/refund`, { reason: 'Cold food complaint' });
    expect(res.json().order).toMatchObject({ status: 'collected', paymentStatus: 'refunded' });
    expect((await orderAudits(w.app, o.id)).map((a) => a.action)).toContain(
      'order.refund_requested_by_admin',
    );

    const cash = await w.place('cash');
    expect((await w.call('POST', `/orders/${cash.id}/refund`, { reason: 'Nope' })).statusCode).toBe(409);
    const missing = await w.call('POST', '/orders/00000000-0000-4000-8000-000000000000/refund', {
      reason: 'Nope',
    });
    expect(missing.statusCode).toBe(404);
    const [row] = await w.app.db.select().from(orders).where(eq(orders.id, o.id));
    expect(row!.status).toBe('collected');
  });
});
