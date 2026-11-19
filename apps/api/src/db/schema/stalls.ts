import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, INDIAN_PHONE_REGEX, publicId, updatedAt } from './_common.js';
import { routeStatus, stallMemberRole, stallStatus } from './enums.js';
import { users } from './users.js';

export const stalls = pgTable(
  'stalls',
  {
    id: publicId(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    description: text(),
    location: text(),
    /** S3 object key of the cover photo (served via CloudFront). */
    photoKey: text(),
    cuisineTags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    isVegOnly: boolean().notNull().default(false),
    status: stallStatus().notNull().default('draft'),
    /** null = follow opening hours; true/false = vendor forced open/closed (reset at midnight). */
    isOpenOverride: boolean(),
    /** "Pause new orders" while staying open. */
    acceptingOrders: boolean().notNull().default(true),
    avgPrepMinutes: smallint().notNull().default(10),
    parallelCapacity: smallint().notNull().default(2),
    upiEnabled: boolean().notNull().default(false),
    cashEnabled: boolean().notNull().default(true),
    razorpayAccountId: text().unique('stalls_razorpay_account_id_unique'),
    /** Razorpay Route product configuration id (acc_prd_…), used to check activation. */
    razorpayRouteProductId: text(),
    routeStatus: routeStatus().notNull().default('not_started'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('stalls_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check('stalls_name_length', sql`char_length(${t.name}) between 2 and 60`),
    check('stalls_avg_prep_range', sql`${t.avgPrepMinutes} between 1 and 120`),
    check('stalls_capacity_range', sql`${t.parallelCapacity} between 1 and 50`),
    index('stalls_status_idx').on(t.status),
  ],
);

/**
 * Weekly opening hours, several slots per day allowed.
 * weekday: ISO 1 = Monday … 7 = Sunday (Asia/Kolkata).
 * closes_at < opens_at means the slot runs past midnight (e.g. 18:00 → 01:00).
 */
export const stallHours = pgTable(
  'stall_hours',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    stallId: uuid()
      .notNull()
      .references(() => stalls.id, { onDelete: 'cascade' }),
    weekday: smallint().notNull(),
    opensAt: time().notNull(),
    closesAt: time().notNull(),
  },
  (t) => [
    check('stall_hours_weekday_range', sql`${t.weekday} between 1 and 7`),
    check('stall_hours_not_empty', sql`${t.opensAt} <> ${t.closesAt}`),
    unique('stall_hours_slot_unique').on(t.stallId, t.weekday, t.opensAt),
    index('stall_hours_stall_idx').on(t.stallId, t.weekday),
  ],
);

/** Which users can manage which stall (spec §3). */
export const stallMembers = pgTable(
  'stall_members',
  {
    stallId: uuid()
      .notNull()
      .references(() => stalls.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: stallMemberRole().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.stallId, t.userId] }), index('stall_members_user_idx').on(t.userId)],
);

/** Phone numbers pre-registered by a super admin; turned into stall_members on first login. */
export const vendorInvites = pgTable(
  'vendor_invites',
  {
    id: publicId(),
    phone: text().notNull(),
    stallId: uuid()
      .notNull()
      .references(() => stalls.id, { onDelete: 'cascade' }),
    role: stallMemberRole().notNull().default('owner'),
    invitedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    acceptedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check('vendor_invites_phone_format', sql`${t.phone} ~ ${sql.raw(`'${INDIAN_PHONE_REGEX}'`)}`),
    unique('vendor_invites_phone_stall_unique').on(t.phone, t.stallId),
    index('vendor_invites_phone_pending_idx')
      .on(t.phone)
      .where(sql`${t.acceptedAt} is null`),
    index('vendor_invites_stall_idx').on(t.stallId),
    index('vendor_invites_invited_by_idx').on(t.invitedBy),
  ],
);
