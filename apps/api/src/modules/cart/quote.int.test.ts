import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { menuCategories, menuItems, platformSettings, stalls } from '../../db/schema/index.js';
import { createTestApp, type TestApp } from '../../test/test-app.js';

/** POST /v1/cart/quote against the real database (each test rolled back). */
let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function setup(stall: Partial<typeof stalls.$inferInsert> = {}) {
  const app = (t = await createTestApp());
  // Make the fee rates explicit for this test (newest settings row wins).
  await app.db.insert(platformSettings).values({
    platformFeeBps: 100,
    cashFeeBps: 500,
    maxOpenCashOrders: 2,
    cashStrikeLimit: 3,
    orderExpiryMinutes: 15,
    congestionLowMaxMinutes: 10,
    congestionModerateMaxMinutes: 20,
  });
  const [s] = await app.db
    .insert(stalls)
    .values({
      slug: 'quote-stall',
      name: 'Quote Stall',
      status: 'active',
      isOpenOverride: true,
      upiEnabled: true,
      routeStatus: 'activated',
      ...stall,
    })
    .returning();
  const [cat] = await app.db.insert(menuCategories).values({ stallId: s!.id, name: 'Food' }).returning();
  const [dosa, idli, paneer, old] = await app.db
    .insert(menuItems)
    .values([
      { stallId: s!.id, categoryId: cat!.id, name: 'Masala Dosa', pricePaise: 6000, isVeg: true },
      { stallId: s!.id, categoryId: cat!.id, name: 'Idli', pricePaise: 3500, isVeg: true },
      {
        stallId: s!.id,
        categoryId: cat!.id,
        name: 'Paneer Dosa',
        pricePaise: 8000,
        isVeg: true,
        isAvailable: false,
      },
      {
        stallId: s!.id,
        categoryId: cat!.id,
        name: 'Old Dish',
        pricePaise: 1000,
        isVeg: true,
        deletedAt: new Date(),
      },
    ])
    .returning();
  const quote = (items: Array<{ itemId: string; quantity: number; pricePaise: number }>, stallId = s!.id) =>
    app.app.inject({ method: 'POST', url: '/v1/cart/quote', payload: { stallId, items } });
  return { app, stall: s!, dosa: dosa!, idli: idli!, paneer: paneer!, old: old!, quote };
}

describe('POST /v1/cart/quote', () => {
  it('prices a cart from the database, with the bill for UPI and cash (₹130 example)', async () => {
    const { dosa, idli, quote } = await setup();
    // 1 × ₹60 + 2 × ₹35 = ₹130
    const res = await quote([
      { itemId: dosa.id, quantity: 1, pricePaise: 6000 },
      { itemId: idli.id, quantity: 2, pricePaise: 3500 },
    ]);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.subtotalPaise).toBe(13000);
    expect(body.options).toEqual({
      upi: { subtotalPaise: 13000, platformFeePaise: 130, cashFeePaise: 0, totalPaise: 13130 },
      cash: { subtotalPaise: 13000, platformFeePaise: 130, cashFeePaise: 650, totalPaise: 13780 },
    });
    expect(body.lines.map((l: { status: string }) => l.status)).toEqual(['ok', 'ok']);
    expect(body).toMatchObject({
      problems: [],
      canCheckout: true,
      rates: { platformFeeBps: 100, cashFeeBps: 500 },
    });
  });

  it('flags a price the vendor changed and uses the new price', async () => {
    const { app, dosa, quote } = await setup();
    await app.db.update(menuItems).set({ pricePaise: 6500 }).where(eq(menuItems.id, dosa.id));
    const body = (await quote([{ itemId: dosa.id, quantity: 2, pricePaise: 6000 }])).json();
    expect(body.lines[0]).toEqual({
      itemId: dosa.id,
      name: 'Masala Dosa',
      quantity: 2,
      status: 'price_changed',
      unitPricePaise: 6500,
      previousPricePaise: 6000,
      lineTotalPaise: 13000,
    });
    expect(body.subtotalPaise).toBe(13000);
    expect(body.problems).toEqual(['items_need_attention']);
    expect(body.canCheckout).toBe(false);
  });

  it('a client cannot lower the price: the database price always wins', async () => {
    const { dosa, quote } = await setup();
    const body = (await quote([{ itemId: dosa.id, quantity: 1, pricePaise: 100 }])).json();
    expect(body.subtotalPaise).toBe(6000);
  });

  it('sold-out, deleted and other-stall dishes are flagged and not charged', async () => {
    const { app, dosa, paneer, old, quote } = await setup();
    const [other] = await app.db
      .insert(stalls)
      .values({ slug: 'other-stall', name: 'Other', status: 'active' })
      .returning();
    const [ocat] = await app.db.insert(menuCategories).values({ stallId: other!.id, name: 'X' }).returning();
    const [foreign] = await app.db
      .insert(menuItems)
      .values({ stallId: other!.id, categoryId: ocat!.id, name: 'Foreign', pricePaise: 500, isVeg: true })
      .returning();

    const body = (
      await quote([
        { itemId: dosa.id, quantity: 1, pricePaise: 6000 },
        { itemId: paneer.id, quantity: 1, pricePaise: 8000 },
        { itemId: old.id, quantity: 1, pricePaise: 1000 },
        { itemId: foreign!.id, quantity: 1, pricePaise: 500 },
      ])
    ).json();
    expect(body.lines.map((l: { status: string }) => l.status)).toEqual([
      'ok',
      'unavailable',
      'removed',
      'removed',
    ]);
    expect(body.subtotalPaise).toBe(6000);
    expect(body.canCheckout).toBe(false);
  });

  it('closed or paused stalls, and stalls without UPI, are reported', async () => {
    const closed = await setup({ isOpenOverride: false });
    const c = (await closed.quote([{ itemId: closed.dosa.id, quantity: 1, pricePaise: 6000 }])).json();
    expect(c.problems).toEqual(['stall_closed']);
    await t!.close();
    t = undefined;

    const paused = await setup({ acceptingOrders: false });
    expect(
      (await paused.quote([{ itemId: paused.dosa.id, quantity: 1, pricePaise: 6000 }])).json().problems,
    ).toEqual(['stall_paused']);
    await t!.close();
    t = undefined;

    const noUpi = await setup({ routeStatus: 'pending' });
    const n = (await noUpi.quote([{ itemId: noUpi.dosa.id, quantity: 1, pricePaise: 6000 }])).json();
    expect(n.options.upi).toBeNull();
    expect(n.options.cash).not.toBeNull();
    expect(n.canCheckout).toBe(true);
  });

  it('an empty cart has nothing to check out', async () => {
    const { quote } = await setup();
    const body = (await quote([])).json();
    expect(body).toMatchObject({ subtotalPaise: 0, options: { upi: null, cash: null }, canCheckout: false });
    expect(body.problems).toContain('empty');
  });

  it('validates input: quantities, duplicates, ids, unknown stall', async () => {
    const { dosa, quote } = await setup();
    expect((await quote([{ itemId: dosa.id, quantity: 0, pricePaise: 6000 }])).statusCode).toBe(400);
    expect((await quote([{ itemId: dosa.id, quantity: 21, pricePaise: 6000 }])).statusCode).toBe(400);
    expect(
      (
        await quote([
          { itemId: dosa.id, quantity: 1, pricePaise: 6000 },
          { itemId: dosa.id, quantity: 2, pricePaise: 6000 },
        ])
      ).statusCode,
    ).toBe(400);
    expect((await quote([{ itemId: 'nope', quantity: 1, pricePaise: 1 }])).statusCode).toBe(400);
    expect((await quote([], '0190a000-0000-7000-8000-000000000000')).statusCode).toBe(404);
  });
});
