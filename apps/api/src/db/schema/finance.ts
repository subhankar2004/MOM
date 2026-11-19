import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, publicId } from './_common.js';
import { ledgerDirection, ledgerEntryType } from './enums.js';
import { orders } from './orders.js';
import { stalls } from './stalls.js';
import { users } from './users.js';

/**
 * Append-only money ledger (spec §4.4). Revenue dashboards and stall statements are
 * built ONLY from this table. A database trigger (migration 0002) rejects UPDATE/DELETE.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    stallId: uuid()
      .notNull()
      .references(() => stalls.id, { onDelete: 'restrict' }),
    orderId: uuid().references(() => orders.id, { onDelete: 'restrict' }),
    entryType: ledgerEntryType().notNull(),
    direction: ledgerDirection().notNull(),
    amountPaise: integer().notNull(),
    note: text(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('ledger_entries_amount_positive', sql`${t.amountPaise} > 0`),
    check(
      'ledger_entries_order_required',
      sql`${t.entryType} in ('settlement','adjustment') or ${t.orderId} is not null`,
    ),
    index('ledger_entries_stall_created_idx').on(t.stallId, t.createdAt),
    index('ledger_entries_created_idx').on(t.createdAt),
    index('ledger_entries_order_idx').on(t.orderId),
    index('ledger_entries_created_by_idx').on(t.createdBy),
  ],
);

/** Cash dues a stall has handed over to MOM (spec A6). */
export const cashSettlements = pgTable(
  'cash_settlements',
  {
    id: publicId(),
    stallId: uuid()
      .notNull()
      .references(() => stalls.id, { onDelete: 'restrict' }),
    amountPaise: integer().notNull(),
    periodStart: date({ mode: 'string' }).notNull(),
    periodEnd: date({ mode: 'string' }).notNull(),
    receivedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [
    check('cash_settlements_amount_positive', sql`${t.amountPaise} > 0`),
    check('cash_settlements_period_order', sql`${t.periodEnd} >= ${t.periodStart}`),
    index('cash_settlements_stall_idx').on(t.stallId, t.periodEnd.desc()),
    index('cash_settlements_received_by_idx').on(t.receivedBy),
  ],
);

/** Who changed what (spec A8). Append-only, enforced by the same trigger as the ledger. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** null = done by the system (a background job). */
    actorId: uuid().references(() => users.id, { onDelete: 'set null' }),
    action: text().notNull(),
    entity: text().notNull(),
    entityId: text(),
    before: jsonb(),
    after: jsonb(),
    ip: text(),
    userAgent: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entity, t.entityId, t.createdAt.desc()),
    index('audit_log_actor_idx').on(t.actorId, t.createdAt.desc()),
    index('audit_log_created_idx').on(t.createdAt.desc()),
  ],
);

/**
 * One reconciliation run (nightly, or started by an admin): the ledger checked against the
 * orders and the Razorpay payment records (spec §4.4). `issues` lists every mismatch found.
 */
export const reconciliationRuns = pgTable(
  'reconciliation_runs',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** Orders created in [periodStart, periodEnd) were checked. */
    periodStart: timestamp({ withTimezone: true }).notNull(),
    periodEnd: timestamp({ withTimezone: true }).notNull(),
    ordersChecked: integer().notNull(),
    /** ok = nothing wrong; mismatch = at least one error (warnings alone stay ok). */
    status: text().notNull(),
    issues: jsonb().notNull(),
    /** null = the nightly job. */
    startedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('reconciliation_runs_status', sql`${t.status} in ('ok', 'mismatch')`),
    index('reconciliation_runs_created_idx').on(t.createdAt.desc()),
  ],
);
