import { calcFees, DEFAULT_FEE_RATES } from '@mom/shared';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPool } from '../test/test-db.js';
import { expectDbError, PG } from '../test/sql-helpers.js';
import { createDb } from './client.js';
import { seed } from './seed/seed.js';
import { testDatabaseUrl } from '../test/test-db.js';

/**
 * Schema v1 integration tests: the database itself must refuse bad data, whatever
 * the application code does. Each test runs in a transaction that is rolled back.
 */
const pool = createTestPool();
let client: pg.PoolClient;

let stallA: string;
let stallB: string;
let categoryA: string;
let categoryB: string;
let itemA: string;
let userId: string;
let settingsId: number;

beforeAll(async () => {
  // Seed once (committed) so every test has stalls, menus and settings to work with.
  const { db, pool: seedPool } = createDb(testDatabaseUrl(), { max: 1 });
  await seed(db, { superAdminPhones: ['+919000000001'], demoStalls: true });
  await seedPool.end();

  const q = async <T extends pg.QueryResultRow>(text: string, params: unknown[] = []) =>
    (await pool.query<T>(text, params)).rows;
  [{ id: stallA }, { id: stallB }] = (await q<{ id: string }>(
    `select id from stalls where slug in ('dosa-corner','chowmein-junction') order by slug desc`,
  )) as [{ id: string }, { id: string }];
  categoryA = (
    await q<{ id: string }>('select id from menu_categories where stall_id = $1 limit 1', [stallA])
  )[0]!.id;
  categoryB = (
    await q<{ id: string }>('select id from menu_categories where stall_id = $1 limit 1', [stallB])
  )[0]!.id;
  itemA = (await q<{ id: string }>('select id from menu_items where stall_id = $1 limit 1', [stallA]))[0]!.id;
  userId = (await q<{ id: string }>(`select id from users where phone = '+919000000001'`))[0]!.id;
  settingsId = (await q<{ id: number }>('select id from platform_settings limit 1'))[0]!.id;
});

beforeEach(async () => {
  client = await pool.connect();
  await client.query('begin');
});

afterEach(async () => {
  await client.query('rollback');
  client.release();
});

afterAll(() => pool.end());

let keyCounter = 0;
/** Builds an order row; override any column. Defaults: a valid ₹130 cash order with token. */
function orderRow(overrides: Record<string, unknown> = {}) {
  const fees = calcFees(13000, 'cash', DEFAULT_FEE_RATES);
  return {
    user_id: userId,
    stall_id: stallA,
    token_day: '2026-11-17',
    token_no: 1,
    pickup_code: '0427',
    status: 'placed',
    payment_method: 'cash',
    payment_status: 'due',
    subtotal_paise: fees.subtotalPaise,
    platform_fee_paise: fees.platformFeePaise,
    cash_fee_paise: fees.cashFeePaise,
    total_paise: fees.totalPaise,
    platform_fee_bps: DEFAULT_FEE_RATES.platformFeeBps,
    cash_fee_bps: DEFAULT_FEE_RATES.cashFeeBps,
    settings_id: settingsId,
    idempotency_key: `test-key-${++keyCounter}`,
    ...overrides,
  };
}

function insertSql(table: string, row: Record<string, unknown>): [string, unknown[]] {
  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  return [
    `insert into ${table} (${cols.join(', ')}) values (${placeholders.join(', ')}) returning *`,
    Object.values(row),
  ];
}

async function insert(table: string, row: Record<string, unknown>) {
  const [text, params] = insertSql(table, row);
  return (await client.query(text, params)).rows[0];
}

async function expectInsertFails(
  table: string,
  row: Record<string, unknown>,
  code: string,
  constraint?: string,
) {
  const [text, params] = insertSql(table, row);
  await expectDbError(client, text, params, { code, constraint });
}

describe('migrations + seed', () => {
  it('created every table from spec §8', async () => {
    const { rows } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'audit_log',
      'auth_otps',
      'cash_settlements',
      'ledger_entries',
      'menu_categories',
      'menu_items',
      'order_items',
      'orders',
      'payments',
      'platform_settings',
      'reconciliation_runs',
      'refresh_tokens',
      'refunds',
      'stall_hours',
      'stall_members',
      'stalls',
      'token_counters',
      'transfers',
      'users',
      'vendor_invites',
      'webhook_events',
    ]);
  });

  it('seeded the default fees, a super admin and 4 demo stalls with menus', async () => {
    const { rows } = await client.query(`
      select (select platform_fee_bps from platform_settings) as platform_bps,
             (select cash_fee_bps from platform_settings) as cash_bps,
             (select role from users where phone = '+919000000001') as role,
             (select count(*)::int from stalls where status = 'active') as stalls,
             (select count(*)::int from menu_items) as items,
             (select count(*)::int from stall_hours) as hours`);
    expect(rows[0]).toEqual({
      platform_bps: 100,
      cash_bps: 500,
      role: 'super_admin',
      stalls: 4,
      items: 29,
      hours: 40,
    });
  });

  it('is idempotent: a second seed changes nothing', async () => {
    const { db, pool: p } = createDb(testDatabaseUrl(), { max: 1 });
    const result = await seed(db, { superAdminPhones: ['+919000000001'], demoStalls: true });
    await p.end();
    expect(result.settingsCreated).toBe(false);
    expect(result.stallsCreated).toEqual([]);
    expect(result.stallsSkipped).toHaveLength(4);
    const { rows } = await client.query('select count(*)::int as n from menu_items');
    expect(rows[0].n).toBe(29);
    expect(result.demoAccounts).toBe(0);
  });

  it('creates the demo accounts with their stall roles', async () => {
    const { rows } = await client.query<{
      phone: string;
      role: string;
      stall: string | null;
      member: string | null;
    }>(
      `select u.phone, u.role, s.slug as stall, m.role as member
         from users u
         left join stall_members m on m.user_id = u.id
         left join stalls s on s.id = m.stall_id
        where u.phone like '+9170000000%' order by u.phone`,
    );
    expect(rows).toEqual([
      { phone: '+917000000001', role: 'student', stall: null, member: null },
      { phone: '+917000000002', role: 'student', stall: null, member: null },
      { phone: '+917000000011', role: 'vendor_owner', stall: 'dosa-corner', member: 'owner' },
      { phone: '+917000000012', role: 'vendor_staff', stall: 'dosa-corner', member: 'staff' },
      { phone: '+917000000013', role: 'vendor_owner', stall: 'chowmein-junction', member: 'owner' },
      { phone: '+917000000014', role: 'vendor_owner', stall: 'chai-and-rolls', member: 'owner' },
      { phone: '+917000000015', role: 'vendor_owner', stall: 'odia-thali-ghar', member: 'owner' },
      { phone: '+917000000021', role: 'super_admin', stall: null, member: null },
    ]);
  });

  it('uuid_generate_v7() embeds the current time with version 7 and RFC variant bits', async () => {
    const { rows } = await client.query<{ id: string; now_ms: string }>(
      `select uuid_generate_v7()::text as id, (extract(epoch from clock_timestamp()) * 1000)::bigint::text as now_ms
         from generate_series(1, 200)`,
    );
    for (const { id, now_ms } of rows) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      const embeddedMs = parseInt(id.replace(/-/g, '').slice(0, 12), 16);
      expect(Math.abs(embeddedMs - Number(now_ms))).toBeLessThan(1000);
    }
    expect(new Set(rows.map((r) => r.id)).size).toBe(200);
  });

  it('generates time-ordered UUIDv7 ids', async () => {
    const { rows } = await client.query<{ id: string }>('select id from stalls order by created_at limit 1');
    expect(rows[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('users', () => {
  it('accepts only +91 mobile numbers', async () => {
    await insert('users', { phone: '+916000000000' });
    for (const phone of ['9876543210', '+915000000000', '+44987654321']) {
      await expectInsertFails('users', { phone }, PG.checkViolation, 'users_phone_format');
    }
  });

  it('allows one account per phone', async () => {
    await expectInsertFails('users', { phone: '+919000000001' }, PG.uniqueViolation, 'users_phone_unique');
  });

  it('only lets a deleted account have no phone', async () => {
    await expectInsertFails('users', { name: 'x' }, PG.checkViolation, 'users_phone_present_unless_deleted');
    await insert('users', { phone: null, deleted_at: new Date() });
  });
});

describe('menu', () => {
  it('rejects an item whose category belongs to another stall', async () => {
    await insert('menu_items', {
      stall_id: stallA,
      category_id: categoryA,
      name: 'OK',
      price_paise: 5000,
      is_veg: true,
    });
    await expectInsertFails(
      'menu_items',
      { stall_id: stallA, category_id: categoryB, name: 'Wrong stall', price_paise: 5000, is_veg: true },
      PG.foreignKeyViolation,
      'menu_items_category_same_stall_fk',
    );
  });

  it('keeps prices between ₹1 and ₹10,000', async () => {
    for (const price_paise of [0, 99, 1_000_001]) {
      await expectInsertFails(
        'menu_items',
        { stall_id: stallA, category_id: categoryA, name: 'X', price_paise, is_veg: true },
        PG.checkViolation,
        'menu_items_price_range',
      );
    }
  });

  it('blocks duplicate live category names per stall (case-insensitive) but allows reuse after delete', async () => {
    await insert('menu_categories', { stall_id: stallA, name: 'Specials' });
    await expectInsertFails(
      'menu_categories',
      { stall_id: stallA, name: 'SPECIALS' },
      PG.uniqueViolation,
      'menu_categories_stall_name_unique',
    );
    await client.query(
      `update menu_categories set deleted_at = now() where stall_id = $1 and name = 'Specials'`,
      [stallA],
    );
    await insert('menu_categories', { stall_id: stallA, name: 'specials' });
    await insert('menu_categories', { stall_id: stallB, name: 'Specials' }); // other stall: fine
  });
});

describe('orders', () => {
  it('accepts orders priced by calcFees (UPI and cash)', async () => {
    await insert('orders', orderRow());
    const upi = calcFees(13000, 'upi', DEFAULT_FEE_RATES);
    await insert(
      'orders',
      orderRow({
        token_no: null,
        token_day: null,
        status: 'pending_payment',
        payment_method: 'upi',
        payment_status: 'pending',
        subtotal_paise: upi.subtotalPaise,
        platform_fee_paise: upi.platformFeePaise,
        cash_fee_paise: upi.cashFeePaise,
        total_paise: upi.totalPaise,
      }),
    );
  });

  it('rejects a total that does not add up', async () => {
    await expectInsertFails(
      'orders',
      orderRow({ total_paise: 13779 }),
      PG.checkViolation,
      'orders_total_matches',
    );
  });

  it('rejects a cash fee on a UPI order', async () => {
    await expectInsertFails(
      'orders',
      orderRow({ payment_method: 'upi', payment_status: 'paid' }),
      PG.checkViolation,
      'orders_upi_has_no_cash_fee',
    );
  });

  it('rejects a payment status that does not fit the method', async () => {
    await expectInsertFails(
      'orders',
      orderRow({ payment_status: 'paid' }),
      PG.checkViolation,
      'orders_payment_status_matches_method',
    );
  });

  it('never issues the same token twice for a stall on the same day', async () => {
    await insert('orders', orderRow({ token_no: 7 }));
    await expectInsertFails(
      'orders',
      orderRow({ token_no: 7 }),
      PG.uniqueViolation,
      'orders_stall_token_unique',
    );
    await insert('orders', orderRow({ token_no: 7, token_day: '2026-11-18' })); // next day: fine
    await insert('orders', orderRow({ token_no: 7, stall_id: stallB })); // other stall: fine
  });

  it('requires a token once an order is placed', async () => {
    await expectInsertFails(
      'orders',
      orderRow({ token_no: null, token_day: null }),
      PG.checkViolation,
      'orders_token_when_issued',
    );
    await expectInsertFails('orders', orderRow({ token_day: null }), PG.checkViolation, 'orders_token_pair');
  });

  it('requires a 4-digit pickup code', async () => {
    for (const pickup_code of ['123', '12345', 'abcd']) {
      await expectInsertFails(
        'orders',
        orderRow({ pickup_code }),
        PG.checkViolation,
        'orders_pickup_code_format',
      );
    }
  });

  it('rejects a reused idempotency key for the same user', async () => {
    await insert('orders', orderRow({ idempotency_key: 'same-key-123' }));
    await expectInsertFails(
      'orders',
      orderRow({ token_no: 2, idempotency_key: 'same-key-123' }),
      PG.uniqueViolation,
      'orders_user_idempotency_unique',
    );
  });

  it('checks order line totals and quantities', async () => {
    const order = await insert('orders', orderRow());
    const line = {
      order_id: order.id,
      menu_item_id: itemA,
      name_snapshot: 'Masala Dosa',
      unit_price_paise: 6000,
    };
    await insert('order_items', { ...line, quantity: 2, line_total_paise: 12000 });
    await expectInsertFails(
      'order_items',
      { ...line, quantity: 2, line_total_paise: 11999 },
      PG.checkViolation,
      'order_items_line_total_matches',
    );
    await expectInsertFails(
      'order_items',
      { ...line, quantity: 0, line_total_paise: 0 },
      PG.checkViolation,
      'order_items_quantity_range',
    );
  });

  it('cannot delete a stall that has orders', async () => {
    await insert('orders', orderRow());
    await expectDbError(client, 'delete from stalls where id = $1', [stallA], {
      code: PG.foreignKeyViolation,
    });
  });
});

describe('append-only tables', () => {
  it('ledger entries can be added but never changed or removed', async () => {
    const order = await insert('orders', orderRow());
    const entry = await insert('ledger_entries', {
      stall_id: stallA,
      order_id: order.id,
      entry_type: 'platform_fee',
      direction: 'credit',
      amount_paise: 130,
    });
    await expectDbError(client, 'update ledger_entries set amount_paise = 1 where id = $1', [entry.id], {
      code: PG.insufficientPrivilege,
    });
    await expectDbError(client, 'delete from ledger_entries where id = $1', [entry.id], {
      code: PG.insufficientPrivilege,
    });
    await expectDbError(client, 'truncate ledger_entries', [], { code: PG.insufficientPrivilege });
  });

  it('fee entries must reference an order; settlements need not', async () => {
    await expectInsertFails(
      'ledger_entries',
      { stall_id: stallA, entry_type: 'cash_fee', direction: 'credit', amount_paise: 650 },
      PG.checkViolation,
      'ledger_entries_order_required',
    );
    await insert('ledger_entries', {
      stall_id: stallA,
      entry_type: 'settlement',
      direction: 'debit',
      amount_paise: 650,
    });
  });

  it('audit log entries can be added but never changed or removed', async () => {
    const entry = await insert('audit_log', {
      actor_id: userId,
      action: 'stall.update',
      entity: 'stall',
      entity_id: stallA,
    });
    await expectDbError(client, `update audit_log set action = 'x' where id = $1`, [entry.id], {
      code: PG.insufficientPrivilege,
    });
    await expectDbError(client, 'delete from audit_log where id = $1', [entry.id], {
      code: PG.insufficientPrivilege,
    });
  });

  it('reconciliation runs can be added but never changed or removed', async () => {
    const run = await insert('reconciliation_runs', {
      period_start: new Date('2026-11-01T00:00:00Z'),
      period_end: new Date('2026-11-08T00:00:00Z'),
      orders_checked: 3,
      status: 'ok',
      issues: '[]',
    });
    await expectDbError(
      client,
      `update reconciliation_runs set status = 'mismatch' where id = $1`,
      [run.id],
      {
        code: PG.insufficientPrivilege,
      },
    );
    await expectDbError(client, 'delete from reconciliation_runs where id = $1', [run.id], {
      code: PG.insufficientPrivilege,
    });
  });
});

describe('platform settings', () => {
  it('keeps fees within 0–20% and congestion thresholds ordered', async () => {
    const valid = {
      platform_fee_bps: 100,
      cash_fee_bps: 500,
      max_open_cash_orders: 2,
      cash_strike_limit: 3,
      order_expiry_minutes: 15,
      congestion_low_max_minutes: 10,
      congestion_moderate_max_minutes: 20,
    };
    await insert('platform_settings', valid);
    await expectInsertFails(
      'platform_settings',
      { ...valid, cash_fee_bps: 2500 },
      PG.checkViolation,
      'platform_settings_cash_fee_range',
    );
    await expectInsertFails(
      'platform_settings',
      { ...valid, congestion_low_max_minutes: 20 },
      PG.checkViolation,
      'platform_settings_congestion_order',
    );
  });
});
