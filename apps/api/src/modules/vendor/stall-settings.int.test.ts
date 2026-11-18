import { and, eq } from 'drizzle-orm';
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

// Wednesday 18 Nov 2026, 12:00 IST.
const NOON = new Date('2026-11-18T12:00:00+05:30');
let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

let seq = 0;
const phone = () => `+9195${String(10_000_000 + ++seq).slice(-8)}`;

async function world(stallValues: Partial<typeof stalls.$inferInsert> = {}) {
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
    .values({ slug: `settings-${++seq}`, name: 'Settings Stall', status: 'active', ...stallValues })
    .returning();
  const [other] = await app.db
    .insert(stalls)
    .values({ slug: `settings-other-${++seq}`, name: 'Other Stall', status: 'active' })
    .returning();
  const [cat] = await app.db.insert(menuCategories).values({ stallId: stall!.id, name: 'Food' }).returning();
  const [dosa] = await app.db
    .insert(menuItems)
    .values({ stallId: stall!.id, categoryId: cat!.id, name: 'Dosa', pricePaise: 6000, isVeg: true })
    .returning();

  const login = async (role: Role, member?: { stallId: string; role: 'owner' | 'staff' }) => {
    const [u] = await app.db.insert(users).values({ phone: phone(), name: role, role }).returning();
    if (member) await app.db.insert(stallMembers).values({ ...member, userId: u!.id });
    const { token } = await signAccessToken(testEnv().JWT_SECRET, { userId: u!.id, role }, 900);
    return { id: u!.id, cookies: { [ACCESS_COOKIE]: token } };
  };
  const owner = await login('vendor_owner', { stallId: stall!.id, role: 'owner' });

  const settings = (method: 'GET' | 'PATCH', payload?: object, who = owner) =>
    app.app.inject({
      method,
      url: `/v1/vendor/stalls/${stall!.id}/settings`,
      cookies: who.cookies,
      payload,
    });
  const hours = (slots: object[], who = owner) =>
    app.app.inject({
      method: 'PUT',
      url: `/v1/vendor/stalls/${stall!.id}/hours`,
      cookies: who.cookies,
      payload: { slots },
    });
  const publicStall = async () =>
    (await app.app.inject({ method: 'GET', url: `/v1/stalls/${stall!.slug}` })).json().stall;
  const quote = async () =>
    (
      await app.app.inject({
        method: 'POST',
        url: '/v1/cart/quote',
        payload: { stallId: stall!.id, items: [{ itemId: dosa!.id, quantity: 1, pricePaise: 6000 }] },
      })
    ).json();

  return { app, stall: stall!, other: other!, owner, login, settings, hours, publicStall, quote };
}

describe('stall settings: access', () => {
  it('is for the stall owner (or a super admin) only', async () => {
    const w = await world();
    expect((await w.settings('GET')).statusCode).toBe(200);
    const staff = await w.login('vendor_staff', { stallId: w.stall.id, role: 'staff' });
    expect((await w.settings('PATCH', { acceptingOrders: false }, staff)).statusCode).toBe(403);
    const outsider = await w.login('vendor_owner', { stallId: w.other.id, role: 'owner' });
    expect((await w.settings('GET', undefined, outsider)).statusCode).toBe(403);
    expect((await w.hours([], outsider)).statusCode).toBe(403);
    const admin = await w.login('super_admin');
    expect((await w.settings('GET', undefined, admin)).statusCode).toBe(200);
  });
});

describe('stall settings: open, close and pause', () => {
  it('opens now, closes now and goes back to following hours', async () => {
    const w = await world();
    // No hours yet: closed by schedule.
    expect((await w.settings('GET')).json().availability).toMatchObject({ state: 'closed', reason: 'hours' });

    const open = await w.settings('PATCH', { isOpenOverride: true });
    expect(open.json().availability).toMatchObject({ state: 'open', reason: 'override' });
    expect((await w.publicStall()).availability.state).toBe('open');

    await w.settings('PATCH', { isOpenOverride: false });
    expect((await w.publicStall()).availability).toMatchObject({ state: 'closed', reason: 'override' });

    const follow = await w.settings('PATCH', { isOpenOverride: null });
    expect(follow.json().settings.isOpenOverride).toBeNull();
    expect(follow.json().availability.reason).toBe('hours');
  });

  it('pauses new orders while staying open, and the list shows it at once', async () => {
    const w = await world({ isOpenOverride: true });
    // Warm the public list cache (the test app caches nothing, but the call path is the same).
    await w.app.app.inject({ method: 'GET', url: '/v1/stalls' });
    const paused = await w.settings('PATCH', { acceptingOrders: false });
    expect(paused.json().availability.state).toBe('paused');
    const list = (await w.app.app.inject({ method: 'GET', url: '/v1/stalls' })).json().stalls;
    expect(list.find((s: { id: string }) => s.id === w.stall.id).availability.state).toBe('paused');
    expect((await w.quote()).canCheckout).toBe(false);
  });
});

describe('stall settings: payment methods', () => {
  it('turning cash off hides it at checkout immediately', async () => {
    const w = await world({ isOpenOverride: true, upiEnabled: true, routeStatus: 'activated' });
    expect((await w.quote()).options.cash).not.toBeNull();
    const res = await w.settings('PATCH', { cashEnabled: false });
    expect(res.json().settings.payments).toEqual({ upi: true, cash: false });
    expect((await w.quote()).options.cash).toBeNull();
    expect((await w.publicStall()).payments).toEqual({ upi: true, cash: false });
  });

  it("won't turn UPI on until the settlement account is active", async () => {
    const w = await world({ routeStatus: 'pending' });
    const res = await w.settings('PATCH', { upiEnabled: true });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/settlement account/);

    await w.app.db.update(stalls).set({ routeStatus: 'activated' }).where(eq(stalls.id, w.stall.id));
    const ok = await w.settings('PATCH', { upiEnabled: true });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().settings.payments.upi).toBe(true);
  });

  it('keeps at least one way to pay', async () => {
    const w = await world({ upiEnabled: false });
    const res = await w.settings('PATCH', { cashEnabled: false });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/at least one payment method/);
  });
});

describe('stall settings: kitchen and profile', () => {
  it('saves prep time, capacity, description and location, and audits the change', async () => {
    const w = await world();
    const res = await w.settings('PATCH', {
      avgPrepMinutes: 12,
      parallelCapacity: 3,
      description: '  Dosas made to order ',
      location: '',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings).toMatchObject({
      avgPrepMinutes: 12,
      parallelCapacity: 3,
      description: 'Dosas made to order',
      location: null,
    });
    const [row] = await w.app.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, w.stall.id), eq(auditLog.action, 'stall.settings.update')));
    expect(row).toMatchObject({
      actorId: w.owner.id,
      before: { avgPrepMinutes: 10, parallelCapacity: 2, description: null },
      after: { avgPrepMinutes: 12, parallelCapacity: 3, description: 'Dosas made to order' },
    });
    expect((await w.settings('PATCH', { avgPrepMinutes: 0 })).statusCode).toBe(400);
    expect((await w.settings('PATCH', { parallelCapacity: 51 })).statusCode).toBe(400);
  });

  it('sets a cover photo from the cover folder only, and deletes the one it replaces', async () => {
    const w = await world();
    const presign = async (purpose: 'cover' | 'item') => {
      const res = await w.app.app.inject({
        method: 'POST',
        url: `/v1/vendor/stalls/${w.stall.id}/uploads/presign`,
        cookies: w.owner.cookies,
        payload: { contentType: 'image/webp', size: 1000, purpose },
      });
      const key = res.json().key as string;
      w.app.images.put(key, 1000);
      return key;
    };
    const dishPhoto = await presign('item');
    expect((await w.settings('PATCH', { photoKey: dishPhoto })).statusCode).toBe(400);

    const first = await presign('cover');
    expect(first).toMatch(new RegExp(`^stalls/${w.stall.id}/cover/`));
    const set = await w.settings('PATCH', { photoKey: first });
    expect(set.json().settings.photoUrl).toBe(`http://localhost:8333/mom-images/${first}`);
    expect((await w.publicStall()).photoUrl).toBe(`http://localhost:8333/mom-images/${first}`);

    const second = await presign('cover');
    await w.settings('PATCH', { photoKey: second });
    expect(w.app.images.deleted).toEqual([first]);
    await w.settings('PATCH', { photoKey: null });
    expect(w.app.images.deleted).toEqual([first, second]);
  });
});

describe('stall settings: opening hours', () => {
  it('replaces the week, which updates open/closed', async () => {
    const w = await world();
    // Wednesday (3): two slots; noon is inside the first.
    const res = await w.hours([
      { weekday: 3, opensAt: '08:00', closesAt: '14:00' },
      { weekday: 3, opensAt: '17:00', closesAt: '21:30' },
      { weekday: 4, opensAt: '08:00', closesAt: '14:00' },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().hours).toHaveLength(3);
    expect(res.json().availability).toMatchObject({ state: 'open', reason: 'hours' });
    expect((await w.publicStall()).availability.state).toBe('open');

    // Move Wednesday to the evening only: closed now, opens at 17:00 IST.
    const later = await w.hours([{ weekday: 3, opensAt: '17:00', closesAt: '21:30' }]);
    expect(later.json().availability).toMatchObject({
      state: 'closed',
      nextOpensAt: new Date('2026-11-18T17:00:00+05:30').toISOString(),
    });
    expect((await w.publicStall()).availability.state).toBe('closed');

    const audits = await w.app.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, w.stall.id), eq(auditLog.action, 'stall.hours.replace')));
    expect(audits).toHaveLength(2);
  });

  it('accepts overnight slots and refuses overlaps', async () => {
    const w = await world();
    expect((await w.hours([{ weekday: 7, opensAt: '18:00', closesAt: '01:00' }])).statusCode).toBe(200);
    // Sunday's late slot runs into Monday 00:00–01:00.
    const overlap = await w.hours([
      { weekday: 7, opensAt: '18:00', closesAt: '01:00' },
      { weekday: 1, opensAt: '00:30', closesAt: '10:00' },
    ]);
    expect(overlap.statusCode).toBe(400);
    expect(overlap.json().error.message).toMatch(/Monday 00:30–10:00 overlaps Sunday 18:00–01:00/);
    const same = await w.hours([
      { weekday: 2, opensAt: '08:00', closesAt: '12:00' },
      { weekday: 2, opensAt: '11:00', closesAt: '15:00' },
    ]);
    expect(same.statusCode).toBe(400);
    expect((await w.hours([{ weekday: 2, opensAt: '08:00', closesAt: '08:00' }])).statusCode).toBe(400);
    expect((await w.hours([{ weekday: 2, opensAt: '8:00', closesAt: '24:00' }])).statusCode).toBe(400);
    // Clearing all hours is allowed (the stall then opens only with "Open now").
    expect((await w.hours([])).json().hours).toEqual([]);
  });
});
