import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { auditLog, menuCategories, menuItems, stallMembers, stalls, users } from '../../db/schema/index.js';
import { createTestApp, testEnv, type TestApp } from '../../test/test-app.js';
import { ACCESS_COOKIE } from '../auth/cookies.js';
import { signAccessToken, type Role } from '../auth/tokens.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

let seq = 0;
const phone = () => `+9194${String(10_000_000 + ++seq).slice(-8)}`;

async function world() {
  const app = (t = await createTestApp());
  const mkStall = async (name: string) =>
    (
      await app.db
        .insert(stalls)
        .values({
          slug: `${name.toLowerCase().replace(/ /g, '-')}-${++seq}`,
          name,
          status: 'active',
          isOpenOverride: true,
        })
        .returning()
    )[0]!;
  const stall = await mkStall('Menu Stall');
  const otherStall = await mkStall('Other Stall');

  const login = async (role: Role, member?: { stallId: string; role: 'owner' | 'staff' }) => {
    const [u] = await app.db.insert(users).values({ phone: phone(), name: role, role }).returning();
    if (member) await app.db.insert(stallMembers).values({ ...member, userId: u!.id });
    const { token } = await signAccessToken(testEnv().JWT_SECRET, { userId: u!.id, role }, 900);
    return { id: u!.id, cookies: { [ACCESS_COOKIE]: token } };
  };
  const owner = await login('vendor_owner', { stallId: stall.id, role: 'owner' });
  const staff = await login('vendor_staff', { stallId: stall.id, role: 'staff' });
  const outsider = await login('vendor_owner', { stallId: otherStall.id, role: 'owner' });
  const student = await login('student');

  const call = (
    who: { cookies: Record<string, string> },
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    payload?: object,
    stallId = stall.id,
  ) => app.app.inject({ method, url: `/v1/vendor/stalls/${stallId}${path}`, cookies: who.cookies, payload });

  const addCategory = async (name: string) => {
    const res = await call(owner, 'POST', '/categories', { name });
    expect(res.statusCode).toBe(201);
    return res.json().category as { id: string; name: string; sortOrder: number };
  };
  const addItem = async (categoryId: string, extra: object = {}) => {
    const res = await call(owner, 'POST', '/items', {
      categoryId,
      name: `Dish ${++seq}`,
      pricePaise: 5000,
      isVeg: true,
      ...extra,
    });
    expect(res.statusCode).toBe(201);
    return res.json().item as { id: string; imageKey: string | null; imageUrl: string | null };
  };
  /** Presigns and "uploads" a photo the way the browser would. */
  const uploadPhoto = async (size = 80_000, stallId = stall.id, who = owner) => {
    const res = await call(who, 'POST', '/uploads/presign', { contentType: 'image/webp', size }, stallId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { key: string; uploadUrl: string; publicUrl: string };
    app.images.put(body.key, size);
    return body;
  };

  return { app, stall, otherStall, owner, staff, outsider, student, call, addCategory, addItem, uploadPhoto };
}

describe('menu editor: access', () => {
  it('lets only the stall owner (or a super admin) edit the menu', async () => {
    const w = await world();
    expect((await w.call(w.owner, 'GET', '/menu')).statusCode).toBe(200);
    // Counter staff run the board but can't touch dishes or prices (spec §3).
    expect((await w.call(w.staff, 'GET', '/menu')).statusCode).toBe(403);
    expect((await w.call(w.student, 'GET', '/menu')).statusCode).toBe(403);
    expect((await w.call(w.outsider, 'POST', '/categories', { name: 'Hijack' })).statusCode).toBe(403);
    const admin = await w.app.db
      .insert(users)
      .values({ phone: phone(), name: 'admin', role: 'super_admin' })
      .returning();
    const { token } = await signAccessToken(
      testEnv().JWT_SECRET,
      { userId: admin[0]!.id, role: 'super_admin' },
      900,
    );
    expect((await w.call({ cookies: { [ACCESS_COOKIE]: token } }, 'GET', '/menu')).statusCode).toBe(200);
    expect(
      (await w.app.app.inject({ method: 'GET', url: `/v1/vendor/stalls/${w.stall.id}/menu` })).statusCode,
    ).toBe(401);
  });

  it("refuses to presign uploads into another stall's folder", async () => {
    const w = await world();
    const res = await w.call(
      w.owner,
      'POST',
      '/uploads/presign',
      { contentType: 'image/webp', size: 1000 },
      w.otherStall.id,
    );
    expect(res.statusCode).toBe(403);
  });

  it("refuses a photo key from another stall's folder", async () => {
    const w = await world();
    const cat = await w.addCategory('Snacks');
    // The outsider uploads to their own stall, then tries to attach it here (and vice versa).
    const theirs = await w.uploadPhoto(1000, w.otherStall.id, w.outsider);
    const res = await w.call(w.owner, 'POST', '/items', {
      categoryId: cat.id,
      name: 'Samosa',
      pricePaise: 1500,
      isVeg: true,
      imageKey: theirs.key,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/doesn't belong/);
    for (const key of [
      '../x.webp',
      `stalls/${w.stall.id}/items/../../evil.webp`,
      `stalls/${w.stall.id}/x.png`,
    ]) {
      const r = await w.call(w.owner, 'POST', '/items', {
        categoryId: cat.id,
        name: 'Samosa',
        pricePaise: 1500,
        isVeg: true,
        imageKey: key,
      });
      expect(r.statusCode).toBe(400);
    }
  });
});

describe('menu editor: photos', () => {
  it('signs uploads into the stall folder and validates type and size', async () => {
    const w = await world();
    const up = await w.uploadPhoto();
    expect(up.key).toMatch(new RegExp(`^stalls/${w.stall.id}/items/[0-9a-f-]{36}\\.webp$`));
    expect(up.publicUrl).toBe(`http://localhost:8333/mom-images/${up.key}`);

    const big = await w.call(w.owner, 'POST', '/uploads/presign', {
      contentType: 'image/webp',
      size: 2 * 1024 * 1024 + 1,
    });
    expect(big.statusCode).toBe(400);
    const gif = await w.call(w.owner, 'POST', '/uploads/presign', { contentType: 'image/gif', size: 100 });
    expect(gif.statusCode).toBe(400);
    const svg = await w.call(w.owner, 'POST', '/uploads/presign', {
      contentType: 'image/svg+xml',
      size: 100,
    });
    expect(svg.statusCode).toBe(400);
  });

  it('creates a dish with a photo that shows on the student menu', async () => {
    const w = await world();
    const cat = await w.addCategory('Dosa');
    const up = await w.uploadPhoto();
    const item = await w.addItem(cat.id, { name: 'Ghee Roast', imageKey: up.key, description: 'Crisp' });
    expect(item.imageUrl).toBe(up.publicUrl);

    const menu = await w.app.app.inject({ method: 'GET', url: `/v1/stalls/${w.stall.slug}/menu` });
    expect(menu.statusCode).toBe(200);
    const dish = menu.json().categories[0].items[0];
    expect(dish).toMatchObject({ name: 'Ghee Roast', imageUrl: up.publicUrl, description: 'Crisp' });
  });

  it('rejects a photo that was never uploaded, is too big or is not an image', async () => {
    const w = await world();
    const cat = await w.addCategory('Dosa');
    const notUploaded = (
      await w.call(w.owner, 'POST', '/uploads/presign', { contentType: 'image/webp', size: 100 })
    ).json().key as string;
    const make = (imageKey: string) =>
      w.call(w.owner, 'POST', '/items', {
        categoryId: cat.id,
        name: 'X',
        pricePaise: 100,
        isVeg: true,
        imageKey,
      });
    expect((await make(notUploaded)).json().error.message).toMatch(/finished uploading/);

    const tooBig = await w.uploadPhoto(100);
    w.app.images.put(tooBig.key, 3 * 1024 * 1024); // uploaded something bigger than approved
    expect((await make(tooBig.key)).statusCode).toBe(400);

    const html = await w.uploadPhoto(100);
    w.app.images.put(html.key, 100, 'text/html');
    expect((await make(html.key)).json().error.message).toMatch(/WebP, JPEG or PNG/);
  });

  it('replaces and removes photos, deleting the old file', async () => {
    const w = await world();
    const cat = await w.addCategory('Dosa');
    const first = await w.uploadPhoto();
    const item = await w.addItem(cat.id, { imageKey: first.key });
    const second = await w.uploadPhoto();

    const replaced = await w.call(w.owner, 'PATCH', `/items/${item.id}`, { imageKey: second.key });
    expect(replaced.json().item.imageKey).toBe(second.key);
    expect(w.app.images.deleted).toEqual([first.key]);

    const removed = await w.call(w.owner, 'PATCH', `/items/${item.id}`, { imageKey: null });
    expect(removed.json().item).toMatchObject({ imageKey: null, imageUrl: null });
    expect(w.app.images.deleted).toEqual([first.key, second.key]);
  });
});

describe('menu editor: categories', () => {
  it('adds, renames, reorders and deletes empty categories', async () => {
    const w = await world();
    const a = await w.addCategory('Dosa');
    const b = await w.addCategory('Drinks');
    expect([a.sortOrder, b.sortOrder]).toEqual([0, 1]);

    const dup = await w.call(w.owner, 'POST', '/categories', { name: ' dosa ' });
    expect(dup.statusCode).toBe(409);
    expect((await w.call(w.owner, 'POST', '/categories', { name: '' })).statusCode).toBe(400);

    const renamed = await w.call(w.owner, 'PATCH', `/categories/${b.id}`, { name: 'Cold drinks' });
    expect(renamed.json().category.name).toBe('Cold drinks');

    expect((await w.call(w.owner, 'PUT', '/categories/order', { ids: [b.id, a.id] })).statusCode).toBe(204);
    const menu = (await w.call(w.owner, 'GET', '/menu')).json();
    expect(menu.categories.map((c: { name: string }) => c.name)).toEqual(['Cold drinks', 'Dosa']);

    // An incomplete list means the page is out of date.
    expect((await w.call(w.owner, 'PUT', '/categories/order', { ids: [a.id] })).statusCode).toBe(409);

    await w.addItem(a.id);
    expect((await w.call(w.owner, 'DELETE', `/categories/${a.id}`)).statusCode).toBe(409);
    expect((await w.call(w.owner, 'DELETE', `/categories/${b.id}`)).statusCode).toBe(204);
    expect((await w.call(w.owner, 'DELETE', `/categories/${b.id}`)).statusCode).toBe(404);
    // A deleted category's name can be used again.
    expect((await w.call(w.owner, 'POST', '/categories', { name: 'Cold drinks' })).statusCode).toBe(201);
  });

  it("can't touch another stall's categories through this stall's URL", async () => {
    const w = await world();
    const [theirs] = await w.app.db
      .insert(menuCategories)
      .values({ stallId: w.otherStall.id, name: 'Theirs' })
      .returning();
    expect((await w.call(w.owner, 'PATCH', `/categories/${theirs!.id}`, { name: 'Mine' })).statusCode).toBe(
      404,
    );
    expect((await w.call(w.owner, 'DELETE', `/categories/${theirs!.id}`)).statusCode).toBe(404);
    const item = await w.call(w.owner, 'POST', '/items', {
      categoryId: theirs!.id,
      name: 'X',
      pricePaise: 100,
      isVeg: true,
    });
    expect(item.statusCode).toBe(400);
  });
});

describe('menu editor: dishes', () => {
  it('edits fields, moves categories and reorders dishes', async () => {
    const w = await world();
    const a = await w.addCategory('Dosa');
    const b = await w.addCategory('Snacks');
    const x = await w.addItem(a.id);
    const y = await w.addItem(a.id);

    const edited = await w.call(w.owner, 'PATCH', `/items/${x.id}`, {
      name: '  Onion Dosa ',
      description: '',
      isVeg: false,
    });
    expect(edited.json().item).toMatchObject({ name: 'Onion Dosa', description: null, isVeg: false });

    expect(
      (await w.call(w.owner, 'PUT', `/categories/${a.id}/items/order`, { ids: [y.id, x.id] })).statusCode,
    ).toBe(204);
    let menu = (await w.call(w.owner, 'GET', '/menu')).json();
    expect(menu.categories[0].items.map((i: { id: string }) => i.id)).toEqual([y.id, x.id]);

    const moved = await w.call(w.owner, 'PATCH', `/items/${x.id}`, { categoryId: b.id });
    expect(moved.json().item.categoryId).toBe(b.id);
    menu = (await w.call(w.owner, 'GET', '/menu')).json();
    expect(menu.categories[1].items.map((i: { id: string }) => i.id)).toEqual([x.id]);

    const bad = await w.call(w.owner, 'PATCH', `/items/${x.id}`, { pricePaise: 50 });
    expect(bad.statusCode).toBe(400);
  });

  it('audits price changes with who, before and after', async () => {
    const w = await world();
    const a = await w.addCategory('Dosa');
    const x = await w.addItem(a.id, { pricePaise: 6000 });

    await w.call(w.owner, 'PATCH', `/items/${x.id}`, { pricePaise: 6500 });
    await w.call(w.owner, 'PATCH', `/items/${x.id}`, { name: 'Renamed', pricePaise: 6500 }); // same price

    const rows = await w.app.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, x.id), eq(auditLog.action, 'menu.item.price_change')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: w.owner.id,
      entity: 'menu_item',
      before: { pricePaise: 6000 },
      after: { pricePaise: 6500 },
    });
  });

  it('soft-deletes dishes so old orders keep them', async () => {
    const w = await world();
    const a = await w.addCategory('Dosa');
    const up = await w.uploadPhoto();
    const x = await w.addItem(a.id, { imageKey: up.key });

    expect((await w.call(w.owner, 'DELETE', `/items/${x.id}`)).statusCode).toBe(204);
    const [row] = await w.app.db.select().from(menuItems).where(eq(menuItems.id, x.id));
    expect(row!.deletedAt).not.toBeNull();
    expect(w.app.images.deleted).toEqual([up.key]);
    expect((await w.call(w.owner, 'GET', '/menu')).json().categories[0].items).toEqual([]);
    expect((await w.call(w.owner, 'PATCH', `/items/${x.id}`, { name: 'Back' })).statusCode).toBe(404);
    const audits = await w.app.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, x.id), eq(auditLog.action, 'menu.item.delete')));
    expect(audits).toHaveLength(1);
  });

  it('marks everything available, or a chosen few sold out', async () => {
    const w = await world();
    const a = await w.addCategory('Dosa');
    const x = await w.addItem(a.id);
    const y = await w.addItem(a.id, { isAvailable: false });
    const z = await w.addItem(a.id, { isAvailable: false });

    const some = await w.call(w.owner, 'POST', '/items/availability', { available: false, itemIds: [x.id] });
    expect(some.json()).toEqual({ changed: 1 });
    const all = await w.call(w.owner, 'POST', '/items/availability', { available: true });
    expect(all.json()).toEqual({ changed: 3 });
    const items = (await w.call(w.owner, 'GET', '/menu')).json().categories[0].items;
    expect(items.every((i: { isAvailable: boolean }) => i.isAvailable)).toBe(true);
    expect([x, y, z]).toHaveLength(3);
  });
});
