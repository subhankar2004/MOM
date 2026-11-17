import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, smallint, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt } from './_common.js';
import { users } from './users.js';

/**
 * Versioned platform settings (spec §4.1, A7). Rows are never edited: a change inserts
 * a new row with a later `effective_from`. The settings in force at time T are the row
 * with the greatest effective_from <= T. Orders snapshot the fee rates they used.
 */
export const platformSettings = pgTable(
  'platform_settings',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** Basis points: 100 = 1 %. */
    platformFeeBps: integer().notNull(),
    cashFeeBps: integer().notNull(),
    maxOpenCashOrders: smallint().notNull(),
    cashStrikeLimit: smallint().notNull(),
    orderExpiryMinutes: smallint().notNull(),
    /** Congestion meter: wait ≤ low → Low, ≤ moderate → Moderate, else Busy. */
    congestionLowMaxMinutes: smallint().notNull(),
    congestionModerateMaxMinutes: smallint().notNull(),
    effectiveFrom: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('platform_settings_platform_fee_range', sql`${t.platformFeeBps} between 0 and 2000`),
    check('platform_settings_cash_fee_range', sql`${t.cashFeeBps} between 0 and 2000`),
    check('platform_settings_max_cash_orders_range', sql`${t.maxOpenCashOrders} between 0 and 20`),
    check('platform_settings_strike_limit_range', sql`${t.cashStrikeLimit} between 1 and 20`),
    check('platform_settings_expiry_range', sql`${t.orderExpiryMinutes} between 5 and 60`),
    check(
      'platform_settings_congestion_order',
      sql`${t.congestionLowMaxMinutes} > 0 and ${t.congestionLowMaxMinutes} < ${t.congestionModerateMaxMinutes}`,
    ),
    index('platform_settings_effective_idx').on(t.effectiveFrom.desc()),
    index('platform_settings_created_by_idx').on(t.createdBy),
  ],
);
