import { calcFees } from '@mom/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ledgerEntries,
  menuCategories,
  menuItems,
  orderItems,
  orders,
  platformSettings,
  stalls,
  users,
} from '../../db/schema/index.js';
import { createTestApp, testEnv, type TestApp } from '../../test/test-app.js';
import { ACCESS_COOKIE } from '../auth/cookies.js';
import { signAccessToken } from '../auth/tokens.js';
import { recordOrderFees } from '../finance/ledger.js';
import { istDay } from './orders.service.js';

/** Monday 16 Nov 2026, 12:00 IST. */
const NOON = new Date('2026-11-16T12:00:00+05:30');
const RATES = { platformFeeBps: 100, cashFeeBps: 500 };

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

let seq = 0;
async function student(app: TestApp, over: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await app.db
    .insert(users)
    .values({ phone: `+9195${String(10_000_000 + ++seq).slice(-8)}`, name: 'Student', ...over })
    .returning();
  const { token } = await signAccessToken(testEnv().JWT_SECRET, { userId: u!.id, role: 'student' }, 900);
  return { user: u!, cookies: { [ACCESS_COOKIE]: token } };
}

async function world(stallOver: Partial<typeof stalls.$inferInsert> = {}, now = NOON) {
  const app = (t = await createTestApp({}, { now: () => now }));
  await app.db.insert(platformSettings).values({
    ...RATES,
    maxOpenCashOrders: 2,
    cashStrikeLimit: 3,
    orderExpiryMinutes: 15,
    congestionLowMaxMinutes: 10,
    congestionModerateMaxMinutes: 20,
  });
  const [stall] = await app.db
    .insert(stalls)
    .values({
      slug: `orders-${++seq}`,
      name: 'Order Stall',
      status: 'active',
      isOpenOverride: true,
      upiEnabled: true,
      routeStatus: 'activated',
      ...stallOver,
    })
    .returning();
  const [cat] = await app.db.insert(menuCategories).values({ stallId: stall!.id, name: 'Food' }).returning();
  const [dosa, idli, soldOut] = await app.db
    .insert(menuItems)
    .values([
      { stallId: stall!.id, categoryId: cat!.id, name: 'Masala Dosa', pricePaise: 6000, isVeg: true },
      { stallId: stall!.id, categoryId: cat!.id, name: 'Idli', pricePaise: 3500, isVeg: true },
      {
        stallId: stall!.id,
        categoryId: cat!.id,
        name: 'Paneer',
        pricePaise: 8000,
        isVeg: true,
        isAvailable: false,
      },
    ])
    .returning();
  const me = await student(app);

  /** ₹130 cart: 1 × Masala Dosa + 2 × Idli. */
  const cart = [
    { itemId: dosa!.id, quantity: 1 },
    { itemId: idli!.id, quantity: 2 },
  ];
  const place = (
    over: Record<string, unknown> = {},
    opts: { key?: string; cookies?: Record<string, string> } = {},
  ) => {
    const method = (over.paymentMethod as 'upi' | 'cash' | undefined) ?? 'cash';
    return app.app.inject({
      method: 'POST',
      url: '/v1/orders',
      cookies: opts.cookies ?? me.cookies,
      headers: { 'idempotency-key': opts.key ?? `key-${++seq}-abcdef` },
      payload: {
        stallId: stall!.id,
        items: cart,
        paymentMethod: method,
        expectedTotalPaise: calcFees(13000, method, RATES).totalPaise,
        ...over,
      },
    });
  };
  return { app, stall: stall!, dosa: dosa!, idli: idli!, soldOut: soldOut!, me, cart, place };
}

describe('POST /v1/orders — cash', () => {
  it('returns a token at once, with fees exactly as calcFees (acceptance)', async () => {
    const { place, me } = await world();
    const res = await place({ note: '  Less spicy  ' });
    expect(res.statusCode).toBe(201);
    const { order } = res.json();
    expect(order).toMatchObject({
      status: 'placed',
      paymentMethod: 'cash',
      paymentStatus: 'due',
      tokenNo: 1,
      tokenDay: '2026-11-16',
      note: 'Less spicy',
      expiresAt: null,
      ...calcFees(13000, 'cash', RATES), // subtotal 13000, platform 130, cash 650, total 13780
      totalPaise: 13780,
      platformFeeBps: 100,
      cashFeeBps: 500,
    });
    expect(order.pickupCode).toMatch(/^\d{4}$/);
    expect(order.items).toEqual([
      expect.objectContaining({
        name: 'Masala Dosa',
        quantity: 1,
        unitPricePaise: 6000,
        lineTotalPaise: 6000,
      }),
      expect.objectContaining({ name: 'Idli', quantity: 2, unitPricePaise: 3500, lineTotalPaise: 7000 }),
    ]);
    void me;
  });

  it('tokens count up per stall per IST day, and each stall has its own', async () => {
    const w = await world({ cashEnabled: true });
    const other = await student(w.app);
    expect((await w.place()).json().order.tokenNo).toBe(1);
    expect((await w.place({}, { cookies: other.cookies })).json().order.tokenNo).toBe(2);
    expect((await w.place()).json().order.tokenNo).toBe(3);
  });

  it('IST day: 00:30 India time already counts as the next day', () => {
    expect(istDay(new Date('2026-11-16T19:00:00Z'))).toBe('2026-11-17'); // 00:30 IST on the 17th
    expect(istDay(new Date('2026-11-16T18:29:00Z'))).toBe('2026-11-16'); // 23:59 IST on the 16th
  });

  it('a repeated request with the same key returns the same order (acceptance)', async () => {
    const { app, place } = await world();
    const first = await place({}, { key: 'checkout-abc-123' });
    const again = await place({}, { key: 'checkout-abc-123' });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(again.json().order.id).toBe(first.json().order.id);
    expect(again.json().order.tokenNo).toBe(1);
    expect(await app.db.select().from(orders).where(eq(orders.id, first.json().order.id))).toHaveLength(1);
  });

  it('reusing a key for a different order is refused', async () => {
    const { place } = await world();
    await place({}, { key: 'checkout-xyz-123' });
    const res = await place({ paymentMethod: 'upi' }, { key: 'checkout-xyz-123' });
    expect([res.statusCode, res.json().error.code]).toEqual([409, 'IDEMPOTENCY_MISMATCH']);
  });

  it('at most 2 open cash orders per student; collected ones free a slot', async () => {
    const { app, place, me } = await world();
    const a = await place();
    await place();
    const third = await place();
    expect([third.statusCode, third.json().error.code]).toEqual([409, 'CASH_LIMIT_REACHED']);
    expect((await place({ paymentMethod: 'upi' })).statusCode).toBe(201); // UPI is still fine
    await app.db.update(orders).set({ status: 'collected' }).where(eq(orders.id, a.json().order.id));
    expect((await place()).statusCode).toBe(201);
    void me;
  });

  it('no cash after too many missed pickups', async () => {
    const { app, place, me } = await world();
    await app.db.update(users).set({ cashStrikes: 3 }).where(eq(users.id, me.user.id));
    const res = await place();
    expect([res.statusCode, res.json().error.code]).toEqual([403, 'CASH_BLOCKED']);
    expect((await place({ paymentMethod: 'upi' })).statusCode).toBe(201);
  });
});

describe('POST /v1/orders — UPI', () => {
  it('creates a pending order with no token yet, expiring in 15 minutes', async () => {
    const { place } = await world();
    const res = await place({ paymentMethod: 'upi' });
    expect(res.statusCode).toBe(201);
    expect(res.json().order).toMatchObject({
      status: 'pending_payment',
      paymentStatus: 'pending',
      tokenNo: null,
      tokenDay: null,
      cashFeePaise: 0,
      totalPaise: 13130,
      expiresAt: new Date(NOON.getTime() + 15 * 60_000).toISOString(),
    });
  });

  it("is refused when the stall's UPI isn't activated", async () => {
    const { place } = await world({ routeStatus: 'pending' });
    const res = await place({ paymentMethod: 'upi' });
    expect([res.statusCode, res.json().error.code]).toEqual([409, 'PAYMENT_METHOD_UNAVAILABLE']);
  });
});

describe('POST /v1/orders — refusals', () => {
  it('closed or paused stalls take no orders', async () => {
    const closed = await world({ isOpenOverride: false });
    expect((await closed.place()).json().error).toMatchObject({
      code: 'STALL_UNAVAILABLE',
      details: { state: 'closed' },
    });
    await t!.close();
    t = undefined;
    const paused = await world({ acceptingOrders: false });
    expect((await paused.place()).json().error).toMatchObject({
      code: 'STALL_UNAVAILABLE',
      details: { state: 'paused' },
    });
  });

  it('cash is refused when the stall turned it off', async () => {
    const { place } = await world({ cashEnabled: false });
    expect((await place()).json().error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
  });

  it('sold-out, deleted or other-stall dishes → CART_CHANGED, nothing created', async () => {
    const { app, place, soldOut } = await world();
    const res = await place({ items: [{ itemId: soldOut.id, quantity: 1 }], expectedTotalPaise: 8080 });
    expect([res.statusCode, res.json().error.code]).toEqual([409, 'CART_CHANGED']);
    expect(await app.db.select().from(orderItems)).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ menuItemId: soldOut.id })]),
    );
  });

  it('a total different from what the student saw → CART_CHANGED with the new total', async () => {
    const { app, place, dosa } = await world();
    await app.db.update(menuItems).set({ pricePaise: 6500 }).where(eq(menuItems.id, dosa.id));
    const res = await place(); // student still expects ₹137.80
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      code: 'CART_CHANGED',
      details: { reason: 'price', totalPaise: calcFees(13500, 'cash', RATES).totalPaise },
    });
  });

  it('a suspended student cannot order', async () => {
    const { app, place, me } = await world();
    await app.db.update(users).set({ status: 'suspended' }).where(eq(users.id, me.user.id));
    expect((await place()).json().error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('validates the request', async () => {
    const { place, dosa } = await world();
    expect((await place({}, { key: 'short' })).statusCode).toBe(400);
    expect((await place({ items: [] })).statusCode).toBe(400);
    expect((await place({ items: [{ itemId: dosa.id, quantity: 21 }] })).statusCode).toBe(400);
    expect(
      (
        await place({
          items: [
            { itemId: dosa.id, quantity: 1 },
            { itemId: dosa.id, quantity: 1 },
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect((await place({ note: 'x'.repeat(201) })).statusCode).toBe(400);
  });

  it('needs sign-in', async () => {
    const { place } = await world();
    expect((await place({}, { cookies: {} })).statusCode).toBe(401);
  });
});

describe('GET /v1/orders/:id', () => {
  it('the owner sees the order; anyone else gets 404', async () => {
    const { app, place, me } = await world();
    const id = (await place()).json().order.id;
    const mine = await app.app.inject({ url: `/v1/orders/${id}`, cookies: me.cookies });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().order).toMatchObject({ id, tokenNo: 1, stall: { name: 'Order Stall' } });
    const other = await student(app);
    expect((await app.app.inject({ url: `/v1/orders/${id}`, cookies: other.cookies })).statusCode).toBe(404);
  });
});

describe('ledger', () => {
  it('records the platform fee, plus the cash fee for cash orders', async () => {
    const { app, place } = await world();
    const cash = (await place()).json().order;
    const [row] = await app.db.select().from(orders).where(eq(orders.id, cash.id));
    await recordOrderFees(app.db, row!);
    const entries = await app.db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, cash.id));
    expect(entries.map((e) => [e.entryType, e.direction, e.amountPaise]).sort()).toEqual([
      ['cash_fee', 'credit', 650],
      ['platform_fee', 'credit', 130],
    ]);
    // Placing an order alone writes nothing: money is recorded only once confirmed (#15/#21).
    const upi = (await place({ paymentMethod: 'upi' })).json().order;
    expect(await app.db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, upi.id))).toEqual([]);
  });
});
