import { sql } from 'drizzle-orm';
import { bigint, check, index, inet, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, INDIAN_PHONE_REGEX, publicId, updatedAt } from './_common.js';
import { userRole, userStatus } from './enums.js';

export const users = pgTable(
  'users',
  {
    id: publicId(),
    /** E.164. Null only after the account is deleted (DPDP), so the number can sign up again. */
    phone: text().unique(),
    name: text(),
    role: userRole().notNull().default('student'),
    status: userStatus().notNull().default('active'),
    /** No-show strikes on cash orders (spec §4.3). */
    cashStrikes: smallint().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check('users_phone_format', sql`${t.phone} ~ ${sql.raw(`'${INDIAN_PHONE_REGEX}'`)}`),
    check('users_phone_present_unless_deleted', sql`${t.phone} is not null or ${t.deletedAt} is not null`),
    check('users_name_length', sql`char_length(${t.name}) between 1 and 60`),
    check('users_cash_strikes_non_negative', sql`${t.cashStrikes} >= 0`),
    index('users_role_idx')
      .on(t.role)
      .where(sql`${t.role} <> 'student'`),
  ],
);

/** One row per OTP sent. Only the hash of the code is stored. */
export const authOtps = pgTable(
  'auth_otps',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    phone: text().notNull(),
    codeHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    attempts: smallint().notNull().default(0),
    consumedAt: timestamp({ withTimezone: true }),
    ip: inet(),
    createdAt: createdAt(),
  },
  (t) => [
    // "latest OTP for this phone" and "how many sent in the last hour" (rate limit)
    index('auth_otps_phone_created_idx').on(t.phone, t.createdAt.desc()),
    index('auth_otps_ip_created_idx').on(t.ip, t.createdAt.desc()),
    check('auth_otps_attempts_range', sql`${t.attempts} between 0 and 20`),
  ],
);

/** Rotating refresh tokens. `familyId` groups a login session; reuse revokes the family. */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: publicId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull().unique('refresh_tokens_token_hash_unique'),
    familyId: uuid().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    userAgent: text(),
    ip: inet(),
    createdAt: createdAt(),
  },
  (t) => [index('refresh_tokens_user_idx').on(t.userId), index('refresh_tokens_family_idx').on(t.familyId)],
);
