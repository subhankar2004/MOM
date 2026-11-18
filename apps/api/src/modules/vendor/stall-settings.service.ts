import { asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { stallHours, stalls } from '../../db/schema/index.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { assertUploadedImage, type ImageStorage } from '../menu/image-storage.js';
import { availability, type HoursSlot } from '../stalls/availability.js';

type StallRow = typeof stalls.$inferSelect;

export interface SettingsPatch {
  /** true = open now, false = closed now, null = follow opening hours (reset at midnight). */
  isOpenOverride?: boolean | null;
  acceptingOrders?: boolean;
  avgPrepMinutes?: number;
  parallelCapacity?: number;
  description?: string | null;
  location?: string | null;
  /** Cover photo key from /uploads/presign (purpose: cover), or null to remove it. */
  photoKey?: string | null;
  upiEnabled?: boolean;
  cashEnabled?: boolean;
}

export interface Actor {
  userId: string;
  ip?: string;
  userAgent?: string;
}

const MIN_PER_DAY = 24 * 60;
const MIN_PER_WEEK = 7 * MIN_PER_DAY;
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/**
 * Slots as [start, end) minutes of the week (Monday 00:00 = 0). A slot that closes at or before
 * it opens runs past midnight into the next day; Sunday's late slot wraps into Monday.
 */
function weekRanges(slot: HoursSlot): Array<[number, number]> {
  const start = (slot.weekday - 1) * MIN_PER_DAY + toMinutes(slot.opensAt);
  let end = (slot.weekday - 1) * MIN_PER_DAY + toMinutes(slot.closesAt);
  if (end <= start) end += MIN_PER_DAY;
  return end > MIN_PER_WEEK
    ? [
        [start, MIN_PER_WEEK],
        [0, end - MIN_PER_WEEK],
      ]
    : [[start, end]];
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Rejects slots that overlap (including overnight ones running into the next day). */
export function assertNoOverlap(slots: HoursSlot[]): void {
  const ranges = slots.flatMap((slot) => weekRanges(slot).map((r) => ({ slot, r })));
  ranges.sort((a, b) => a.r[0] - b.r[0]);
  for (let i = 1; i < ranges.length; i++) {
    const prev = ranges[i - 1]!;
    const cur = ranges[i]!;
    if (cur.r[0] < prev.r[1]) {
      throw badRequest(
        `${DAY_NAMES[cur.slot.weekday - 1]} ${cur.slot.opensAt}–${cur.slot.closesAt} overlaps ` +
          `${DAY_NAMES[prev.slot.weekday - 1]} ${prev.slot.opensAt}–${prev.slot.closesAt}`,
      );
    }
  }
}

/** UPI only counts once the stall's Razorpay settlement account is active (spec V7). */
const upiUsable = (s: Pick<StallRow, 'upiEnabled' | 'routeStatus'>) =>
  s.upiEnabled && s.routeStatus === 'activated';

/** The stall's settings page (spec §6.2 V6, V7). */
export class StallSettingsService {
  private readonly imageBase: string;
  private readonly upiOnline: boolean;

  constructor(
    private readonly db: Db,
    private readonly storage: ImageStorage,
    options: { publicImageBaseUrl: string; upiOnline: boolean },
  ) {
    this.imageBase = options.publicImageBaseUrl.replace(/\/$/, '');
    this.upiOnline = options.upiOnline;
  }

  async get(stallId: string, now: Date) {
    const [stall] = await this.db.select().from(stalls).where(eq(stalls.id, stallId));
    if (!stall) throw notFound('Stall not found');
    const hours = await this.hours(this.db, stallId);
    return this.view(stall, hours, now);
  }

  async update(stallId: string, patch: SettingsPatch, actor: Actor, now: Date) {
    if (patch.photoKey) await assertUploadedImage(this.storage, stallId, patch.photoKey, 'cover');
    const { view, oldPhoto } = await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(stalls).where(eq(stalls.id, stallId)).for('update');
      if (!before) throw notFound('Stall not found');

      const changes: Partial<typeof stalls.$inferInsert> = {};
      for (const key of Object.keys(patch) as Array<keyof SettingsPatch>) {
        const value = patch[key];
        if (value === undefined) continue;
        const normalised = (key === 'description' || key === 'location') && value === '' ? null : value;
        if (before[key] !== normalised) Object.assign(changes, { [key]: normalised });
      }
      const after = { ...before, ...changes };

      if (changes.upiEnabled === true && before.routeStatus !== 'activated') {
        throw conflict(
          'UPI can be turned on once your settlement account is active. The MOM team sets this up.',
        );
      }
      // Students must be able to pay somehow; to stop orders, pause instead.
      if (
        (changes.upiEnabled === false || changes.cashEnabled === false) &&
        !upiUsable(after) &&
        !after.cashEnabled
      ) {
        throw conflict('Keep at least one payment method on. To stop new orders, pause them instead.');
      }
      if (Object.keys(changes).length === 0) {
        return { view: this.view(before, await this.hours(tx, stallId), now), oldPhoto: null };
      }

      const [saved] = await tx.update(stalls).set(changes).where(eq(stalls.id, stallId)).returning();
      await audit(tx, {
        actorId: actor.userId,
        action: 'stall.settings.update',
        entity: 'stall',
        entityId: stallId,
        before: Object.fromEntries(Object.keys(changes).map((k) => [k, before[k as keyof StallRow]])),
        after: changes,
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
      const replaced = changes.photoKey !== undefined && before.photoKey ? before.photoKey : null;
      return { view: this.view(saved!, await this.hours(tx, stallId), now), oldPhoto: replaced };
    });
    if (oldPhoto) await this.storage.delete(oldPhoto).catch(() => {});
    return view;
  }

  /** Replaces the whole weekly timetable. */
  async replaceHours(stallId: string, slots: HoursSlot[], actor: Actor, now: Date) {
    for (const s of slots) {
      if (s.opensAt === s.closesAt) throw badRequest('Opening and closing times must be different');
    }
    assertNoOverlap(slots);
    return this.db.transaction(async (tx) => {
      const [stall] = await tx.select().from(stalls).where(eq(stalls.id, stallId)).for('update');
      if (!stall) throw notFound('Stall not found');
      const before = await this.hours(tx, stallId);
      await tx.delete(stallHours).where(eq(stallHours.stallId, stallId));
      if (slots.length > 0) await tx.insert(stallHours).values(slots.map((s) => ({ ...s, stallId })));
      const after = await this.hours(tx, stallId);
      await audit(tx, {
        actorId: actor.userId,
        action: 'stall.hours.replace',
        entity: 'stall',
        entityId: stallId,
        before,
        after,
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
      return this.view(stall, after, now);
    });
  }

  private async hours(db: Db, stallId: string): Promise<HoursSlot[]> {
    const rows = await db
      .select({ weekday: stallHours.weekday, opensAt: stallHours.opensAt, closesAt: stallHours.closesAt })
      .from(stallHours)
      .where(eq(stallHours.stallId, stallId))
      .orderBy(asc(stallHours.weekday), asc(stallHours.opensAt));
    return rows.map((h) => ({
      weekday: h.weekday,
      opensAt: h.opensAt.slice(0, 5),
      closesAt: h.closesAt.slice(0, 5),
    }));
  }

  private view(stall: StallRow, hours: HoursSlot[], now: Date) {
    return {
      settings: {
        name: stall.name,
        status: stall.status,
        description: stall.description,
        location: stall.location,
        photoKey: stall.photoKey,
        photoUrl: stall.photoKey ? `${this.imageBase}/${stall.photoKey}` : null,
        isOpenOverride: stall.isOpenOverride,
        acceptingOrders: stall.acceptingOrders,
        avgPrepMinutes: stall.avgPrepMinutes,
        parallelCapacity: stall.parallelCapacity,
        upiEnabled: stall.upiEnabled,
        cashEnabled: stall.cashEnabled,
        routeStatus: stall.routeStatus,
        /** What students see: UPI needs the switch, an active settlement account and a gateway. */
        payments: { upi: this.upiOnline && upiUsable(stall), cash: stall.cashEnabled },
      },
      hours,
      availability: availability(
        {
          status: stall.status,
          isOpenOverride: stall.isOpenOverride,
          acceptingOrders: stall.acceptingOrders,
          hours,
        },
        now,
      ),
    };
  }
}
