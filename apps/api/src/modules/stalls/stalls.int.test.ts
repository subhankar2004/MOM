import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditLog,
  menuCategories,
  menuItems,
  orders,
  platformSettings,
  stallHours,
  stalls,
  users,
} from '../../db/schema/index.js';
import { createTestApp, type TestApp } from '../../test/test-app.js';
import { resetStallOverrides } from './stalls.service.js';

/** Monday 16 Nov 2026, 12:00 IST — the fixed "now" for these tests. */
const NOON_MONDAY = new Date('2026-11-16T12:00:00+05:30');

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

type StallInsert = typeof stalls.$inferInsert;

async function addStall(
  app: TestApp,
  slug: string,
  over: Partial<StallInsert> = {},
  hours?: [string, string],
) {
  const [s] = await app.db
    .insert(stalls)
    .values({ slug, name: `Stall ${slug}`, status: 'active', ...over })
    .returning();
  const [opensAt, closesAt] = hours ?? ['07:30', '21:30'];
  await app.db
    .insert(stallHours)
    .values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ stallId: s!.id, weekday, opensAt, closesAt })));
  return s!;
}

async function addItems(app: TestApp, stallId: string, items: Array<[number, boolean, boolean?]>) {
  const [cat] = await app.db.insert(menuCategories).values({ stallId, name: 'Food' }).returning();
  await app.db.insert(menuItems).values(
    items.map(([pricePaise, isAvailable, deleted]) => ({
      stallId,
      categoryId: cat!.id,
      name: `Item ${pricePaise}`,
      pricePaise,
      isVeg: true,
      isAvailable,
      deletedAt: deleted ? new Date() : null,
    })),
  );
}

let orderSeq = 0;
async function addActiveOrders(app: TestApp, stallId: string, count: number) {
  const [user] = await app.db
    .insert(users)
    .values({ phone: `+919700${String(100000 + ++orderSeq).slice(-6)}` })
    .returning();
  const [settings] = await app.db
    .insert(platformSettings)
    .values({
      platformFeeBps: 100,
      cashFeeBps: 500,
      maxOpenCashOrders: 2,
      cashStrikeLimit: 3,
      orderExpiryMinutes: 15,
      congestionLowMaxMinutes: 10,
      congestionModerateMaxMinutes: 20,
      effectiveFrom: sql`now() - interval '1 day'`,
    })
    .returning();
  for (let i = 1; i <= count; i++) {
    await app.db.insert(orders).values({
      userId: user!.id,
      stallId,
      tokenDay: '2026-11-16',
      tokenNo: i,
      pickupCode: '1234',
      status: i % 2 ? 'placed' : 'preparing',
      paymentMethod: 'cash',
      paymentStatus: 'due',
      subtotalPaise: 10000,
      platformFeePaise: 100,
      cashFeePaise: 500,
      totalPaise: 10600,
      platformFeeBps: 100,
      cashFeeBps: 500,
      settingsId: settings!.id,
      idempotencyKey: `order-key-${orderSeq}-${i}`,
    });
  }
}

interface StallJson {
  slug: string;
  availability: { state: string } & Record<string, unknown>;
  congestion: unknown;
  payments: unknown;
  startingPricePaise: number | null;
}
/** Only the stalls this test created (the test database may hold others). */
const mine = (list: StallJson[], prefix: string) => list.filter((s) => s.slug.startsWith(prefix));

describe('GET /v1/stalls', () => {
  it('shows open, paused and closed stalls in that order; hides draft and suspended ones', async () => {
    const app = (t = await createTestApp({}, { now: () => NOON_MONDAY }));
    await addStall(app, 't1-closed', {}, ['19:00', '22:00']);
    await addStall(app, 't1-open');
    await addStall(app, 't1-paused', { acceptingOrders: false });
    await addStall(app, 't1-draft', { status: 'draft' });
    await addStall(app, 't1-suspended', { status: 'suspended' });
    await addStall(app, 't1-forced-closed', { isOpenOverride: false });

    const res = await app.app.inject('/v1/stalls');
    expect(res.statusCode).toBe(200);
    const list = mine(res.json().stalls, 't1-');
    expect(list.map((s) => [s.slug, s.availability.state])).toEqual([
      ['t1-open', 'open'],
      ['t1-paused', 'paused'],
      ['t1-closed', 'closed'], // opens at 19:00 today — sooner than the forced-closed one (unknown)
      ['t1-forced-closed', 'closed'],
    ]);
    const closed = list.find((s) => s.slug === 't1-closed')!;
    expect(closed.availability).toEqual({
      state: 'closed',
      reason: 'hours',
      closesAt: null,
      nextOpensAt: '2026-11-16T13:30:00.000Z', // 19:00 IST
    });
    const open = list.find((s) => s.slug === 't1-open')!;
    expect(open.availability).toMatchObject({ state: 'open', closesAt: '2026-11-16T16:00:00.000Z' }); // 21:30 IST
    expect(res.headers['cache-control']).toBe('public, max-age=15, stale-while-revalidate=30');
  });

  it('works without signing in', async () => {
    const app = (t = await createTestApp());
    expect((await app.app.inject('/v1/stalls')).statusCode).toBe(200);
  });

  it('congestion counts only active orders; busy stalls sort after quiet ones', async () => {
    const app = (t = await createTestApp({}, { now: () => NOON_MONDAY }));
    const quiet = await addStall(app, 't2-quiet', { avgPrepMinutes: 8, parallelCapacity: 2 });
    const busy = await addStall(app, 't2-busy', { avgPrepMinutes: 8, parallelCapacity: 2 });
    await addActiveOrders(app, busy.id, 6); // ceil(7/2) × 8 = 32 min
    await addActiveOrders(app, quiet.id, 1); // ceil(2/2) × 8 = 8 min
    // A collected order doesn't count
    await app.db.execute(sql`update orders set status = 'collected' where stall_id = ${quiet.id}`);

    const list = mine((await app.app.inject('/v1/stalls')).json().stalls, 't2-');
    expect(list.map((s) => [s.slug, s.congestion])).toEqual([
      ['t2-quiet', { level: 'low', waitMinutes: 8 }],
      ['t2-busy', { level: 'busy', waitMinutes: 32 }],
    ]);
  });

  it('meter thresholds come from the current platform settings', async () => {
    const app = (t = await createTestApp({}, { now: () => NOON_MONDAY }));
    await addStall(app, 't3-x', { avgPrepMinutes: 12, parallelCapacity: 1 });
    await app.db.insert(platformSettings).values({
      platformFeeBps: 100,
      cashFeeBps: 500,
      maxOpenCashOrders: 2,
      cashStrikeLimit: 3,
      orderExpiryMinutes: 15,
      congestionLowMaxMinutes: 15, // 12 min wait now counts as low
      congestionModerateMaxMinutes: 30,
    });
    const [x] = mine((await app.app.inject('/v1/stalls')).json().stalls, 't3-') as Array<{
      congestion: unknown;
    }>;
    expect(x!.congestion).toEqual({ level: 'low', waitMinutes: 12 });
  });

  it('UPI shows only when the Razorpay account is activated; starting price ignores unavailable items', async () => {
    const app = (t = await createTestApp({}, { now: () => NOON_MONDAY }));
    const a = await addStall(app, 't4-a', { upiEnabled: true, routeStatus: 'activated' });
    await addStall(app, 't4-b', { upiEnabled: true, routeStatus: 'pending', cashEnabled: false });
    await addItems(app, a.id, [
      [6000, true],
      [3000, false], // sold out
      [2000, true, true], // deleted
      [4500, true],
    ]);
    const list = mine((await app.app.inject('/v1/stalls')).json().stalls, 't4-');
    expect(list.map((s) => [s.slug, s.payments, s.startingPricePaise])).toEqual([
      ['t4-a', { upi: true, cash: true }, 4500],
      ['t4-b', { upi: false, cash: false }, null],
    ]);
  });
});

describe('GET /v1/stalls/:slug', () => {
  it('returns the stall with its weekly hours (HH:MM)', async () => {
    const app = (t = await createTestApp({}, { now: () => NOON_MONDAY }));
    await addStall(app, 't5-chai', {}, ['17:00', '01:00']);
    const res = await app.app.inject('/v1/stalls/t5-chai');
    expect(res.statusCode).toBe(200);
    const stall = res.json().stall;
    expect(stall.hours).toHaveLength(7);
    expect(stall.hours[0]).toEqual({ weekday: 1, opensAt: '17:00', closesAt: '01:00' });
    expect(stall.availability).toMatchObject({ state: 'closed', nextOpensAt: '2026-11-16T11:30:00.000Z' });
  });

  it('404 for unknown and draft stalls, 400 for a malformed slug', async () => {
    const app = (t = await createTestApp());
    await addStall(app, 't6-draft', { status: 'draft' });
    expect((await app.app.inject('/v1/stalls/t6-draft')).statusCode).toBe(404);
    expect((await app.app.inject('/v1/stalls/no-such-stall')).statusCode).toBe(404);
    expect((await app.app.inject('/v1/stalls/Bad_Slug!')).json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('midnight reset of vendor switches', () => {
  it('puts every overridden stall back on its schedule and audits it', async () => {
    const app = (t = await createTestApp());
    const a = await addStall(app, 't7-a', { isOpenOverride: true });
    const b = await addStall(app, 't7-b', { isOpenOverride: false });
    const c = await addStall(app, 't7-c');

    const reset = await resetStallOverrides(app.db);
    expect(reset).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(reset).not.toContain(c.id);
    const rows = await app.db.select({ o: stalls.isOpenOverride }).from(stalls).where(eq(stalls.id, a.id));
    expect(rows[0]!.o).toBeNull();
    const [entry] = await app.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'stall.override.midnight_reset'));
    expect((entry!.after as { stallIds: string[] }).stallIds).toEqual(expect.arrayContaining([a.id, b.id]));

    expect(await resetStallOverrides(app.db)).toEqual([]); // nothing left to reset
  });
});
