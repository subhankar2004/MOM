import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, publicId, updatedAt } from './_common.js';
import { paymentAttemptStatus, paymentProvider, refundStatus, transferStatus } from './enums.js';
import { orders } from './orders.js';
import { stalls } from './stalls.js';
import { users } from './users.js';

/** One row per payment attempt with the gateway (an order may need a retry). */
export const payments = pgTable(
  'payments',
  {
    id: publicId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    provider: paymentProvider().notNull().default('razorpay'),
    providerOrderId: text().notNull().unique('payments_provider_order_id_unique'),
    providerPaymentId: text().unique('payments_provider_payment_id_unique'),
    amountPaise: integer().notNull(),
    status: paymentAttemptStatus().notNull().default('created'),
    /** Latest raw gateway payload, for support/debugging. Never contains card data. */
    raw: jsonb(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('payments_amount_positive', sql`${t.amountPaise} > 0`),
    index('payments_order_idx').on(t.orderId),
  ],
);

export const refunds = pgTable(
  'refunds',
  {
    id: publicId(),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    amountPaise: integer().notNull(),
    providerRefundId: text().unique('refunds_provider_refund_id_unique'),
    status: refundStatus().notNull().default('pending'),
    reason: text().notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('refunds_amount_positive', sql`${t.amountPaise} > 0`),
    index('refunds_payment_idx').on(t.paymentId),
    index('refunds_order_idx').on(t.orderId),
    index('refunds_created_by_idx').on(t.createdBy),
  ],
);

/** Razorpay Route transfers of the food value to the stall's linked account (spec §4.2). */
export const transfers = pgTable(
  'transfers',
  {
    id: publicId(),
    orderId: uuid()
      .notNull()
      .unique('transfers_order_id_unique')
      .references(() => orders.id, { onDelete: 'restrict' }),
    stallId: uuid()
      .notNull()
      .references(() => stalls.id, { onDelete: 'restrict' }),
    providerTransferId: text().unique('transfers_provider_transfer_id_unique'),
    amountPaise: integer().notNull(),
    status: transferStatus().notNull().default('created'),
    /** Released to the stall's bank (order collected). */
    releasedAt: timestamp({ withTimezone: true }),
    /** Pulled back (order refunded). */
    reversedAt: timestamp({ withTimezone: true }),
    /** Razorpay calls tried so far (the retry job gives up after 5) and the last error. */
    attempts: integer().notNull().default(0),
    lastError: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('transfers_amount_positive', sql`${t.amountPaise} > 0`),
    index('transfers_status_idx').on(t.status),
    index('transfers_stall_created_idx').on(t.stallId, t.createdAt.desc()),
  ],
);

/** Every gateway webhook received, de-duplicated by the provider's event id. */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: publicId(),
    provider: text().notNull(),
    eventId: text().notNull(),
    eventType: text().notNull(),
    payload: jsonb().notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
    error: text(),
  },
  (t) => [
    unique('webhook_events_provider_event_unique').on(t.provider, t.eventId),
    index('webhook_events_unprocessed_idx')
      .on(t.receivedAt)
      .where(sql`${t.processedAt} is null`),
  ],
);
