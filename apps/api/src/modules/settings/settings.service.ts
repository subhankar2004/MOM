import { desc, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { platformSettings } from '../../db/schema/index.js';
import { DEFAULT_SETTINGS } from '../../db/seed/demo-data.js';
import { audit } from '../../lib/audit.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';

export type PlatformSettings = Omit<typeof platformSettings.$inferSelect, 'createdBy' | 'createdAt'>;

/**
 * The settings in force now: the newest row whose effective_from has passed (spec §4.1).
 * Falls back to the defaults if the table is empty (fresh database before seeding).
 */
export async function getCurrentSettings(db: Db): Promise<PlatformSettings> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(lte(platformSettings.effectiveFrom, sql`now()`))
    .orderBy(desc(platformSettings.effectiveFrom), desc(platformSettings.id))
    .limit(1);
  return row ?? { id: 0, effectiveFrom: new Date(0), ...DEFAULT_SETTINGS };
}

export type SettingsInput = Omit<PlatformSettings, 'id' | 'effectiveFrom'>;

const FIELDS: Array<keyof SettingsInput> = [
  'platformFeeBps',
  'cashFeeBps',
  'maxOpenCashOrders',
  'cashStrikeLimit',
  'orderExpiryMinutes',
  'congestionLowMaxMinutes',
  'congestionModerateMaxMinutes',
  'cashEnabledGlobally',
  'orderingPaused',
];

/** Current settings, changes waiting for their effective time, and the last 20 versions. */
export async function settingsOverview(db: Db) {
  const current = await getCurrentSettings(db);
  const [scheduled, history] = await Promise.all([
    db
      .select()
      .from(platformSettings)
      .where(sql`${platformSettings.effectiveFrom} > now()`)
      .orderBy(platformSettings.effectiveFrom),
    db
      .select()
      .from(platformSettings)
      .where(lte(platformSettings.effectiveFrom, sql`now()`))
      .orderBy(desc(platformSettings.effectiveFrom), desc(platformSettings.id))
      .limit(20),
  ]);
  return { current, scheduled, history };
}

/**
 * Saves new platform settings as a new version (spec §4.1: rows are never edited). Orders keep
 * the fee rates they were placed with, so a fee change affects only orders placed after
 * `effectiveFrom` (now when omitted). Only one change may be waiting at a time: a scheduled
 * row would otherwise bring back old values on top of a newer change. Audited with the diff.
 */
export async function saveSettings(
  db: Db,
  input: SettingsInput & { effectiveFrom?: Date },
  actor: { actorId: string; ip?: string; userAgent?: string },
  now: Date,
) {
  if (input.congestionLowMaxMinutes >= input.congestionModerateMaxMinutes) {
    throw badRequest('"Moderately busy" must start after "not busy" ends');
  }
  if (input.effectiveFrom && input.effectiveFrom.getTime() > now.getTime() + 366 * 86_400_000) {
    throw badRequest('Schedule changes at most a year ahead');
  }
  const scheduleLater = input.effectiveFrom !== undefined && input.effectiveFrom.getTime() > now.getTime();
  return db.transaction(async (tx) => {
    // One settings change at a time.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mom.platform_settings'))`);
    const [waiting] = await tx
      .select({ id: platformSettings.id, effectiveFrom: platformSettings.effectiveFrom })
      .from(platformSettings)
      .where(sql`${platformSettings.effectiveFrom} > now()`)
      .limit(1);
    if (waiting) {
      throw new AppError(
        409,
        'CONFLICT',
        'A change is already scheduled. Cancel it first, then save again.',
        { scheduledId: waiting.id, effectiveFrom: waiting.effectiveFrom },
      );
    }
    const current = await getCurrentSettings(tx);
    const changed = FIELDS.filter((f) => current[f] !== input[f]);
    if (changed.length === 0) throw badRequest('Nothing changed');
    const values = Object.fromEntries(FIELDS.map((f) => [f, input[f]])) as SettingsInput;
    const [row] = await tx
      .insert(platformSettings)
      .values({
        ...values,
        createdBy: actor.actorId,
        ...(scheduleLater ? { effectiveFrom: input.effectiveFrom } : {}),
      })
      .returning();
    await audit(tx, {
      actorId: actor.actorId,
      action: scheduleLater ? 'platform.settings.schedule' : 'platform.settings.change',
      entity: 'platform_settings',
      entityId: String(row!.id),
      before: Object.fromEntries(changed.map((f) => [f, current[f]])),
      after: { ...Object.fromEntries(changed.map((f) => [f, input[f]])), effectiveFrom: row!.effectiveFrom },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return row!;
  });
}

/** Cancels a change that hasn't taken effect yet (no order can have used it). Audited. */
export async function cancelScheduledSettings(
  db: Db,
  id: number,
  actor: { actorId: string; ip?: string; userAgent?: string },
) {
  await db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(platformSettings)
      .where(sql`${platformSettings.id} = ${id} and ${platformSettings.effectiveFrom} > now()`)
      .returning();
    if (!removed) throw notFound('No scheduled change with that id (it may already be in force)');
    await audit(tx, {
      actorId: actor.actorId,
      action: 'platform.settings.cancel_scheduled',
      entity: 'platform_settings',
      entityId: String(id),
      before: {
        ...Object.fromEntries(FIELDS.map((f) => [f, removed[f]])),
        effectiveFrom: removed.effectiveFrom,
      },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  });
}
