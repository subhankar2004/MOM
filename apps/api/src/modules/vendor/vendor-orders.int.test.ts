import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditLog,
  menuCategories,
  menuItems,
  orders,
  platformSettings,
  stallMembers,
  stalls,
  users,
} from '../../db/schema/index.js';
import { createTestApp, testEnv, type TestApp } from '../../test/test-app.js';
import { ACCESS_COOKIE } from '../auth/cookies.js';
import { signAccessToken, type Role } from '../auth/tokens.js';
import type { FakeGateway } from '../payments/gateway.js';

const NOON = new Date('2026-11-18T12:00:00+05:30');
let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

let seq = 0;
const phone = () => `+9193${String(10_000_000 + ++seq).slice(-8)}`;

async function world() {
  const app = (t = await createTestApp({}, { now: () => NOON }));
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
  const outsider = await cookiesFor('vendor_owner', otherStall.id);

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
  const board = (cookies = vendor.cookies, stallId = stall.id) =>
    app.app.inject({ url: `/v1/vendor/stalls/${stallId}/orders`, cookies });
  const act = (orderId: string, action: string, body?: object, cookies = vendor.cookies) =>
    app.app.inject({
      method: 'POST',
      url: `/v1/vendor/stalls/${stall.id}/orders/${orderId}/${action}`,
      cookies,
      ...(body ? { payload: body } : {}),
    });
  return { app, stall, otherStall, student, vendor, outsider, place, pay, board, act };
}

describe('GET /v1/vendor/stalls/:stallId/orders', () => {
  it('shows paid/cash orders first come first served, with items and note — not unpaid UPI', async () => {
    const w = await world();
    const a = await w.place('cash', 'less spicy');
    const unpaid = await w.place('upi');
    const b = await w.place('upi');
    await w.pay(b.id);
    const res = await w.board();
    expect(res.statusCode).toBe(200);
    const { active } = res.json();
    expect(active.map((o: { id: string }) => o.id)).toEqual([a.id, b.id]);
    expect(active.map((o: { id: string }) => o.id)).not.toContain(unpaid.id);
    expect(active[0]).toMatchObject({
      tokenNo: 1,
      status: 'placed',
      paymentMethod: 'cash',
      paymentStatus: 'due',
      totalPaise: 12720,
      note: 'less spicy',
      items: [{ name: 'Masala Dosa', quantity: 2 }],
    });
    expect(active[1]).toMatchObject({ tokenNo: 2, paymentMethod: 'upi', paymentStatus: 'paid' });
    // The stall sees the order, not who placed it.
    expect(JSON.stringify(active)).not.toMatch(/userId|phone/);
  });

  it('only for members of this stall (or a super admin)', async () => {
    const w = await world();
    expect((await w.board(w.outsider.cookies)).statusCode).toBe(403);
    expect((await w.board(w.student.cookies)).statusCode).toBe(403);
    const admin = await w.app.db.insert(users).values({ phone: phone(), role: 'super_admin' }).returning();
    const { token } = await signAccessToken(
      testEnv().JWT_SECRET,
      { userId: admin[0]!.id, role: 'super_admin' },
      900,
    );
    expect((await w.board({ [ACCESS_COOKIE]: token })).statusCode).toBe(200);
  });
});

describe('moving orders along', () => {
  it('accept → preparing → ready, each audited; a repeated tap is harmless', async () => {
    const w = await world();
    const o = await w.place();
    const accepted = await w.act(o.id, 'accept');
    expect(accepted.json()).toMatchObject({ order: { status: 'preparing' }, refund: 'none' });
    expect(accepted.json().order.acceptedAt).not.toBeNull();
    expect((await w.act(o.id, 'accept')).statusCode).toBe(200); // second tablet, same tap
    const ready = await w.act(o.id, 'ready');
    expect(ready.json().order).toMatchObject({ status: 'ready' });
    const entries = await w.app.db
      .select({ action: auditLog.action, actorId: auditLog.actorId })
      .from(auditLog)
      .where(eq(auditLog.entityId, o.id));
    expect(entries).toEqual([
      { action: 'order.accept', actorId: w.vendor.id },
      { action: 'order.ready', actorId: w.vendor.id },
    ]);
    // The student's own view follows.
    const mine = await w.app.app.inject({ url: `/v1/orders/${o.id}`, cookies: w.student.cookies });
    expect(mine.json().order.status).toBe('ready');
  });

  it('something instant can go straight from placed to ready', async () => {
    const w = await world();
    const o = await w.place();
    expect((await w.act(o.id, 'ready')).json().order).toMatchObject({ status: 'ready' });
  });

  it('refuses moves the lifecycle does not allow', async () => {
    const w = await world();
    const o = await w.place();
    await w.act(o.id, 'ready');
    const back = await w.act(o.id, 'accept');
    expect([back.statusCode, back.json().error.message]).toEqual([
      409,
      'This order is already marked ready.',
    ]);
    const reject = await w.act(o.id, 'reject', { reason: 'Out of batter' });
    expect(reject.statusCode).toBe(409);

    const cancelled = await w.place();
    await w.app.app.inject({
      method: 'POST',
      url: `/v1/orders/${cancelled.id}/cancel`,
      cookies: w.student.cookies,
    });
    expect((await w.act(cancelled.id, 'accept')).json().error.message).toBe(
      'The student cancelled this order.',
    );
  });

  it("another stall's order, or an unpaid one, is not found", async () => {
    const w = await world();
    const o = await w.place();
    const res = await w.app.app.inject({
      method: 'POST',
      url: `/v1/vendor/stalls/${w.otherStall.id}/orders/${o.id}/accept`,
      cookies: w.outsider.cookies,
    });
    expect(res.statusCode).toBe(404);
    expect((await w.act(o.id, 'accept', undefined, w.outsider.cookies)).statusCode).toBe(403);
    const unpaid = await w.place('upi');
    expect((await w.act(unpaid.id, 'accept')).statusCode).toBe(404);
  });

  it('reject needs a reason, and lands in today’s finished list', async () => {
    const w = await world();
    const o = await w.place();
    expect((await w.act(o.id, 'reject', { reason: ' ' })).statusCode).toBe(400);
    const res = await w.act(o.id, 'reject', { reason: 'Out of batter' });
    expect(res.json()).toMatchObject({
      order: { status: 'rejected', rejectReason: 'Out of batter' },
      refund: 'none',
    });
    const { active, finishedToday } = (await w.board()).json();
    expect(active).toEqual([]);
    expect(finishedToday[0]).toMatchObject({ id: o.id, status: 'rejected' });
  });

  it('rejecting a paid UPI order refunds it in full', async () => {
    const w = await world();
    const o = await w.place('upi');
    const paymentId = await w.pay(o.id);
    await w.act(o.id, 'accept');
    const res = await w.act(o.id, 'reject', { reason: 'Gas ran out' });
    expect(res.json()).toMatchObject({
      order: { status: 'rejected', paymentStatus: 'refunded' },
      refund: 'started',
    });
    expect((w.app.app.paymentGateway as FakeGateway).refunds).toEqual([
      expect.objectContaining({ paymentId, amountPaise: 12120 }),
    ]);
    const [audit] = await w.app.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, o.id), eq(auditLog.action, 'order.reject')));
    expect(audit!.after).toMatchObject({ status: 'rejected', reason: 'Gas ran out' });
  });

  it('if the refund cannot start, the order is still rejected and marked refund pending', async () => {
    const w = await world();
    const o = await w.place('upi');
    await w.pay(o.id);
    const gw = w.app.app.paymentGateway as FakeGateway;
    const original = gw.refund.bind(gw);
    gw.refund = async () => {
      throw new Error('gateway down');
    };
    const res = await w.act(o.id, 'reject', { reason: 'Closing early' });
    gw.refund = original;
    expect(res.json()).toMatchObject({
      order: { status: 'rejected', paymentStatus: 'refund_pending' },
      refund: 'retry_later',
    });
    const [row] = await w.app.db.select().from(orders).where(eq(orders.id, o.id));
    expect(row!.paymentStatus).toBe('refund_pending');
  });
});
