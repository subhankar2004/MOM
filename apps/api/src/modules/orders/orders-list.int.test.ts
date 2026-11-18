import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { menuCategories, menuItems, orders, platformSettings, stalls, users } from '../../db/schema/index.js';
import { createTestApp, testEnv, type TestApp } from '../../test/test-app.js';
import { ACCESS_COOKIE } from '../auth/cookies.js';
import { signAccessToken } from '../auth/tokens.js';
import type { FakeGateway } from '../payments/gateway.js';

const NOON = new Date('2026-11-16T12:00:00+05:30');
let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

let seq = 0;
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
  const [stall] = await app.db
    .insert(stalls)
    .values({
      slug: `list-${++seq}`,
      name: 'List Stall',
      status: 'active',
      isOpenOverride: true,
      upiEnabled: true,
      routeStatus: 'activated',
    })
    .returning();
  const [cat] = await app.db.insert(menuCategories).values({ stallId: stall!.id, name: 'Food' }).returning();
  const [dosa, idli] = await app.db
    .insert(menuItems)
    .values([
      { stallId: stall!.id, categoryId: cat!.id, name: 'Masala Dosa', pricePaise: 6000, isVeg: true },
      { stallId: stall!.id, categoryId: cat!.id, name: 'Idli', pricePaise: 3000, isVeg: true },
    ])
    .returning();
  const [u] = await app.db
    .insert(users)
    .values({ phone: `+9192${String(10_000_000 + ++seq).slice(-8)}`, name: 'Lister' })
    .returning();
  const { token } = await signAccessToken(testEnv().JWT_SECRET, { userId: u!.id, role: 'student' }, 900);
  const cookies = { [ACCESS_COOKIE]: token };
  const place = async (method: 'cash' | 'upi' = 'cash') =>
    (
      await app.app.inject({
        method: 'POST',
        url: '/v1/orders',
        cookies,
        headers: { 'idempotency-key': `list-key-${++seq}-abc` },
        payload: {
          stallId: stall!.id,
          items: [
            { itemId: dosa!.id, quantity: 2 },
            { itemId: idli!.id, quantity: 1 },
          ],
          paymentMethod: method,
          expectedTotalPaise: method === 'cash' ? 15900 : 15150,
        },
      })
    ).json().order;
  const list = async (query: string) =>
    (await app.app.inject({ url: `/v1/orders?${query}`, cookies })).json();
  const cancel = (id: string, c = cookies) =>
    app.app.inject({ method: 'POST', url: `/v1/orders/${id}/cancel`, cookies: c });
  const setStatus = (id: string, status: 'preparing' | 'collected') =>
    app.db
      .update(orders)
      .set({ status, ...(status === 'collected' ? { paymentStatus: 'paid_cash' as const } : {}) })
      .where(eq(orders.id, id));
  return { app, cookies, place, list, cancel, setStatus };
}

describe('GET /v1/orders', () => {
  it('active orders (with item preview) vs past orders', async () => {
    const w = await world();
    const a = await w.place();
    const b = await w.place();
    await w.setStatus(a.id, 'collected');
    const active = await w.list('scope=active');
    expect(active.orders.map((o: { id: string }) => o.id)).toEqual([b.id]);
    expect(active.orders[0]).toMatchObject({
      itemCount: 3,
      itemsPreview: '2 × Masala Dosa, 1 × Idli',
      tokenNo: 2,
      totalPaise: 15900,
    });
    expect((await w.list('scope=past')).orders.map((o: { id: string }) => o.id)).toEqual([a.id]);
  });

  it('past orders are paginated newest first with a cursor', async () => {
    const w = await world();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const o = await w.place();
      await w.app.db
        .update(orders)
        .set({
          status: 'collected',
          paymentStatus: 'paid_cash',
          createdAt: new Date(NOON.getTime() + i * 60_000),
        })
        .where(eq(orders.id, o.id));
      ids.push(o.id);
    }
    const page1 = await w.list('scope=past&limit=2');
    expect(page1.orders.map((o: { id: string }) => o.id)).toEqual([ids[4], ids[3]]);
    const page2 = await w.list(`scope=past&limit=2&before=${page1.nextBefore}`);
    expect(page2.orders.map((o: { id: string }) => o.id)).toEqual([ids[2], ids[1]]);
    const page3 = await w.list(`scope=past&limit=2&before=${page2.nextBefore}`);
    expect(page3).toMatchObject({ orders: [expect.objectContaining({ id: ids[0] })], nextBefore: null });
  });
});

describe('GET /v1/orders pagination with identical timestamps', () => {
  it('never skips or repeats an order', async () => {
    const w = await world();
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const o = await w.place();
      await w.app.db
        .update(orders)
        .set({ status: 'collected', paymentStatus: 'paid_cash', createdAt: NOON })
        .where(eq(orders.id, o.id));
      ids.add(o.id);
    }
    const seen: string[] = [];
    let before: string | null = null;
    do {
      const page: { orders: Array<{ id: string }>; nextBefore: string | null } = await w.list(
        `scope=past&limit=2${before ? `&before=${before}` : ''}`,
      );
      seen.push(...page.orders.map((o) => o.id));
      before = page.nextBefore;
    } while (before);
    expect(seen).toHaveLength(5);
    expect(new Set(seen)).toEqual(ids);
  });

  it('rejects a cursor that is not an order id', async () => {
    const w = await world();
    const res = await w.app.app.inject({ url: '/v1/orders?scope=past&before=yesterday', cookies: w.cookies });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /v1/orders/:id/cancel', () => {
  it('a placed cash order can be cancelled (and frees the cash slot)', async () => {
    const w = await world();
    const o = await w.place();
    const res = await w.cancel(o.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().order).toMatchObject({ status: 'cancelled', pickupQr: null });
  });

  it('too late once the stall is preparing', async () => {
    const w = await world();
    const o = await w.place();
    await w.setStatus(o.id, 'preparing');
    const res = await w.cancel(o.id);
    expect([res.statusCode, res.json().error.message]).toEqual([
      409,
      expect.stringContaining('already started'),
    ]);
  });

  it('a paid UPI order is refunded when cancelled', async () => {
    const w = await world();
    const o = await w.place('upi');
    const start = await w.app.app.inject({
      method: 'POST',
      url: '/v1/payments/razorpay/order',
      cookies: w.cookies,
      payload: { orderId: o.id },
    });
    const { createHmac } = await import('node:crypto');
    const rzp = start.json().razorpayOrderId;
    await w.app.app.inject({
      method: 'POST',
      url: '/v1/payments/razorpay/verify',
      cookies: w.cookies,
      payload: {
        orderId: o.id,
        razorpayOrderId: rzp,
        razorpayPaymentId: 'pay_cancel',
        razorpaySignature: createHmac('sha256', testEnv().RAZORPAY_KEY_SECRET!)
          .update(`${rzp}|pay_cancel`)
          .digest('hex'),
      },
    });
    const res = await w.cancel(o.id);
    expect(res.json().order).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded' });
    expect((w.app.app.paymentGateway as FakeGateway).refunds).toEqual([
      expect.objectContaining({ paymentId: 'pay_cancel', amountPaise: 15150 }),
    ]);
  });

  it("someone else's order: 404", async () => {
    const w = await world();
    const o = await w.place();
    const { token } = await signAccessToken(
      testEnv().JWT_SECRET,
      { userId: '0190a000-0000-7000-8000-000000000001', role: 'student' },
      900,
    );
    expect((await w.cancel(o.id, { [ACCESS_COOKIE]: token })).statusCode).toBe(404);
  });
});
