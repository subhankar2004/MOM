import { desc, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { platformSettings } from '../../db/schema/index.js';
import { DEFAULT_SETTINGS } from '../../db/seed/demo-data.js';

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
