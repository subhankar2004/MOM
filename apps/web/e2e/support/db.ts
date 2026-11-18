import pg from 'pg';
import { E2E_DATABASE_URL, PHONE_PREFIX } from './env';

/** Direct database access for arranging test data (roles) and cleaning up. */
export async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  if (!new URL(E2E_DATABASE_URL).pathname.endsWith('_test')) {
    throw new Error('Browser tests only run against a *_test database');
  }
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Retires the accounts a previous run created so this run starts with fresh ones.
 * Like real account deletion, users are anonymised rather than deleted: the audit log
 * refers to them and is append-only, so hard deletes are (rightly) impossible.
 */
export function resetTestUsers() {
  return withDb(async (db) => {
    const like = `${PHONE_PREFIX}%`;
    await db.query(
      `update refresh_tokens set revoked_at = now()
         where revoked_at is null and user_id in (select id from users where phone like $1)`,
      [like],
    );
    await db.query(`update users set phone = null, name = null, deleted_at = now() where phone like $1`, [
      like,
    ]);
    await db.query(`delete from vendor_invites where phone like $1`, [like]);
    // Stalls created by tests (slug e2e-…) and their orders
    await db.query(`delete from orders where stall_id in (select id from stalls where slug like 'e2e-%')`);
    await db.query(`delete from stalls where slug like 'e2e-%'`);
    await db.query(`delete from auth_otps where phone like $1`, [like]);
  });
}

/** Creates (or resets) an account directly, e.g. an admin who then signs in through the UI. */
export function createUser(phone: string, name: string, role: 'student' | 'vendor_owner' | 'super_admin') {
  return withDb((db) =>
    db.query(
      `insert into users (phone, name, role) values ($1, $2, $3)
       on conflict (phone) do update set name = excluded.name, role = excluded.role`,
      [phone, name, role],
    ),
  );
}

export function setRole(phone: string, role: 'student' | 'vendor_owner' | 'super_admin') {
  return withDb((db) => db.query(`update users set role = $2 where phone = $1`, [phone, role]));
}

/** IST wall clock of now + `minutes` → { weekday 1–7, "HH:MM" }. */
function istSlot(minutesFromNow: number) {
  const ist = new Date(Date.now() + (minutesFromNow + 330) * 60_000);
  const jsDay = ist.getUTCDay();
  const hhmm = `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
  return { weekday: jsDay === 0 ? 7 : jsDay, hhmm };
}

/**
 * A stall for one test. `opensInMinutes` > 0 makes it closed now and opening later
 * (a one-hour slot); `open: true` forces it open (vendor switch).
 */
export function createTestStall(
  slug: string,
  options: {
    open?: boolean;
    opensInMinutes?: number;
    avgPrepMinutes?: number;
    parallelCapacity?: number;
    /** Accept UPI (Razorpay Route account activated). */
    upi?: boolean;
  } = {},
) {
  return withDb(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `insert into stalls (slug, name, status, is_open_override, avg_prep_minutes, parallel_capacity, cuisine_tags,
                           upi_enabled, route_status)
       values ($1, $2, 'active', $3, $4, $5, '{Test}', $6, $7) returning id`,
      [
        slug,
        `Test ${slug.replace(/^e2e-/, '')}`,
        options.open ? true : null,
        options.avgPrepMinutes ?? 10,
        options.parallelCapacity ?? 1,
        options.upi ?? false,
        options.upi ? 'activated' : 'not_started',
      ],
    );
    const id = rows[0]!.id;
    if (options.opensInMinutes) {
      const opens = istSlot(options.opensInMinutes);
      const closes = istSlot(options.opensInMinutes + 60);
      await db.query(
        `insert into stall_hours (stall_id, weekday, opens_at, closes_at) values ($1, $2, $3, $4)`,
        [id, opens.weekday, opens.hhmm, closes.hhmm],
      );
    }
    return id;
  });
}

/** Puts `count` orders in the stall's queue (status placed). */
export function addActiveOrders(stallId: string, count: number) {
  return withDb(async (db) => {
    const { rows: u } = await db.query<{ id: string }>(
      `select id from users where deleted_at is null limit 1`,
    );
    const { rows: st } = await db.query<{ id: number }>(
      `select id from platform_settings order by id desc limit 1`,
    );
    for (let i = 1; i <= count; i++) {
      await db.query(
        `insert into orders (user_id, stall_id, token_day, token_no, pickup_code, status, payment_method, payment_status,
           subtotal_paise, platform_fee_paise, cash_fee_paise, total_paise, platform_fee_bps, cash_fee_bps, settings_id,
           idempotency_key)
         values ($1, $2, current_date, $3, '1234', 'placed', 'cash', 'due', 10000, 100, 500, 10600, 100, 500, $4, $5)`,
        [u[0]!.id, stallId, i, st[0]!.id, `e2e-${stallId}-${i}`],
      );
    }
  });
}

/** Gives a stall a menu: [category, [name, price ₹, available?][]][] */
export function addMenu(stallId: string, menu: Array<[string, Array<[string, number, boolean?]>]>) {
  return withDb(async (db) => {
    for (const [ci, [category, items]] of menu.entries()) {
      const { rows } = await db.query<{ id: string }>(
        `insert into menu_categories (stall_id, name, sort_order) values ($1, $2, $3) returning id`,
        [stallId, category, ci],
      );
      for (const [ii, [name, rupees, available]] of items.entries()) {
        await db.query(
          `insert into menu_items (stall_id, category_id, name, price_paise, is_veg, is_available, sort_order, description)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            stallId,
            rows[0]!.id,
            name,
            rupees * 100,
            ii % 3 !== 0,
            available ?? true,
            ii,
            `Fresh ${name.toLowerCase()}`,
          ],
        );
      }
    }
  });
}

/** Changes a dish the way a stall owner would (price in ₹, availability). */
export function updateDish(stallId: string, name: string, change: { rupees?: number; available?: boolean }) {
  return withDb((db) =>
    db.query(
      `update menu_items set price_paise = coalesce($3, price_paise), is_available = coalesce($4, is_available)
       where stall_id = $1 and name = $2`,
      [stallId, name, change.rupees === undefined ? null : change.rupees * 100, change.available ?? null],
    ),
  );
}

/** Opens or closes a stall with the vendor switch (true/false), or back to its hours (null). */
export function setStallOpen(stallId: string, open: boolean | null) {
  return withDb((db) => db.query(`update stalls set is_open_override = $2 where id = $1`, [stallId, open]));
}
