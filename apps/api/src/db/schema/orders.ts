import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, publicId, updatedAt } from './_common.js';
import { orderPaymentStatus, orderStatus, paymentMethod } from './enums.js';
import { menuItems } from './menu.js';
import { platformSettings } from './settings.js';
import { stalls } from './stalls.js';
import { users } from './users.js';

/**
 * Per-stall, per-day token counter (Asia/Kolkata day). Issued under a row lock
 * (`select … for update`) so two orders can never get the same token (#14).
 */
export const tokenCounters = pgTable(
  'token_counters',
  {
    stallId: uuid()
      .notNull()
      .references(() => stalls.id, { onDelete: 'cascade' }),
    day: date({ mode: 'string' }).notNull(),
    lastToken: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.stallId, t.day] }),
    check('token_counters_last_token_non_negative', sql`${t.lastToken} >= 0`),
  ],
);

const ACTIVE_STATUSES = sql.raw(`('placed','preparing','ready')`);
const TOKEN_STATUSES = sql.raw(`('placed','preparing','ready','collected')`);

export const orders = pgTable(
  'orders',
  {
    id: publicId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    stallId: uuid()
      .notNull()
      .references(() => stalls.id, { onDelete: 'restrict' }),
    /** Token is issued when the order becomes `placed` (cash: at once; UPI: after payment). */
    tokenDay: date({ mode: 'string' }),
    tokenNo: integer(),
    /** 4 random digits checked together with the token at the counter (spec §5). */
    pickupCode: text().notNull(),
    status: orderStatus().notNull(),
    paymentMethod: paymentMethod().notNull(),
    paymentStatus: orderPaymentStatus().notNull(),

    subtotalPaise: integer().notNull(),
    platformFeePaise: integer().notNull(),
    cashFeePaise: integer().notNull(),
    totalPaise: integer().notNull(),
    /** Fee rates snapshotted at order time — later fee changes never alter this order. */
    platformFeeBps: integer().notNull(),
    cashFeeBps: integer().notNull(),
    settingsId: bigint({ mode: 'number' })
      .notNull()
      .references(() => platformSettings.id, { onDelete: 'restrict' }),

    note: text(),
    rejectReason: text(),
    /** Client-generated key so a retried "Place order" never creates a duplicate. */
    idempotencyKey: text().notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    expiresAt: timestamp({ withTimezone: true }),
    placedAt: timestamp({ withTimezone: true }),
    acceptedAt: timestamp({ withTimezone: true }),
    readyAt: timestamp({ withTimezone: true }),
    collectedAt: timestamp({ withTimezone: true }),
    closedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    // --- money integrity ---
    check('orders_subtotal_positive', sql`${t.subtotalPaise} > 0`),
    check('orders_fees_non_negative', sql`${t.platformFeePaise} >= 0 and ${t.cashFeePaise} >= 0`),
    check(
      'orders_total_matches',
      sql`${t.totalPaise} = ${t.subtotalPaise} + ${t.platformFeePaise} + ${t.cashFeePaise}`,
    ),
    check('orders_upi_has_no_cash_fee', sql`${t.paymentMethod} = 'cash' or ${t.cashFeePaise} = 0`),
    check(
      'orders_fee_bps_range',
      sql`${t.platformFeeBps} between 0 and 2000 and ${t.cashFeeBps} between 0 and 2000`,
    ),
    check(
      'orders_payment_status_matches_method',
      sql`(${t.paymentMethod} = 'upi' and ${t.paymentStatus} in ('pending','paid','refund_pending','refunded','failed'))
       or (${t.paymentMethod} = 'cash' and ${t.paymentStatus} in ('due','paid_cash','failed'))`,
    ),
    // --- token integrity ---
    check('orders_token_pair', sql`(${t.tokenNo} is null) = (${t.tokenDay} is null)`),
    check('orders_token_positive', sql`${t.tokenNo} is null or ${t.tokenNo} > 0`),
    check('orders_token_when_issued', sql`${t.status} not in ${TOKEN_STATUSES} or ${t.tokenNo} is not null`),
    check('orders_pickup_code_format', sql`${t.pickupCode} ~ '^[0-9]{4}$'`),
    check('orders_note_length', sql`char_length(${t.note}) <= 200`),
    check('orders_idempotency_key_length', sql`char_length(${t.idempotencyKey}) between 8 and 100`),
    unique('orders_stall_token_unique').on(t.stallId, t.tokenDay, t.tokenNo),
    unique('orders_user_idempotency_unique').on(t.userId, t.idempotencyKey),
    // --- query patterns ---
    index('orders_user_created_idx').on(t.userId, t.createdAt.desc()), // "My orders"
    index('orders_stall_created_idx').on(t.stallId, t.createdAt.desc()), // vendor reports
    index('orders_stall_active_idx') // vendor board + congestion meter
      .on(t.stallId, t.status)
      .where(sql`${t.status} in ${ACTIVE_STATUSES}`),
    index('orders_pending_expiry_idx') // expiry job
      .on(t.expiresAt)
      .where(sql`${t.status} = 'pending_payment'`),
    index('orders_user_open_cash_idx') // cash-order limit per student
      .on(t.userId)
      .where(sql`${t.paymentMethod} = 'cash' and ${t.status} in ${ACTIVE_STATUSES}`),
    index('orders_settings_idx').on(t.settingsId),
    index('orders_created_idx').on(t.createdAt.desc()), // admin explorer
  ],
);

/** Order lines with name and price snapshotted at order time. */
export const orderItems = pgTable(
  'order_items',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    menuItemId: uuid()
      .notNull()
      .references(() => menuItems.id, { onDelete: 'restrict' }),
    nameSnapshot: text().notNull(),
    unitPricePaise: integer().notNull(),
    quantity: smallint().notNull(),
    lineTotalPaise: integer().notNull(),
  },
  (t) => [
    check('order_items_quantity_range', sql`${t.quantity} between 1 and 50`),
    check('order_items_unit_price_positive', sql`${t.unitPricePaise} > 0`),
    check('order_items_line_total_matches', sql`${t.lineTotalPaise} = ${t.unitPricePaise} * ${t.quantity}`),
    index('order_items_order_idx').on(t.orderId),
    index('order_items_menu_item_idx').on(t.menuItemId),
  ],
);
