import { and, asc, eq, inArray, isNotNull, isNull, min, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { menuItems, orders, stallHours, stalls } from '../../db/schema/index.js';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { getCurrentSettings } from '../settings/settings.service.js';
import { availability, congestion, type HoursSlot } from './availability.js';

type StallRow = typeof stalls.$inferSelect;

export interface PublicStall {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  location: string | null;
  photoUrl: string | null;
  cuisineTags: string[];
  isVegOnly: boolean;
  availability: ReturnType<typeof availability>;
  congestion: ReturnType<typeof congestion>;
  payments: { upi: boolean; cash: boolean };
  startingPricePaise: number | null;
}

const STATE_ORDER = { open: 0, paused: 1, closed: 2 } as const;

export interface StallsServiceOptions {
  publicImageBaseUrl: string;
  now?: () => Date;
  /** How long the public list is reused (spec §10: 15 s). 0 disables caching (tests). */
  cacheTtlMs?: number;
}

/** Public stall directory: open/closed, congestion and payment methods (spec §6.1 S2, §10). */
export class StallsService {
  private cache: { at: number; value: PublicStall[] } | null = null;
  private readonly now: () => Date;

  constructor(
    private readonly db: Db,
    private readonly options: StallsServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  /** Active stalls: open first (shortest wait first), then paused, then closed (soonest opening first). */
  async list(): Promise<PublicStall[]> {
    const ttl = this.options.cacheTtlMs ?? 15_000;
    const nowMs = this.now().getTime();
    if (ttl > 0 && this.cache && nowMs - this.cache.at < ttl) return this.cache.value;

    const rows = await this.db.select().from(stalls).where(eq(stalls.status, 'active'));
    const value = (await this.describe(rows)).sort(compareStalls);
    if (ttl > 0) this.cache = { at: nowMs, value };
    return value;
  }

  async getBySlug(slug: string): Promise<PublicStall & { hours: HoursSlot[] }> {
    const [row] = await this.db
      .select()
      .from(stalls)
      .where(and(eq(stalls.slug, slug), eq(stalls.status, 'active')));
    if (!row) throw notFound('Stall not found');
    const [described] = await this.describe([row]);
    const hours = await this.db
      .select({ weekday: stallHours.weekday, opensAt: stallHours.opensAt, closesAt: stallHours.closesAt })
      .from(stallHours)
      .where(eq(stallHours.stallId, row.id))
      .orderBy(asc(stallHours.weekday), asc(stallHours.opensAt));
    return { ...described!, hours: hours.map(trimSeconds) };
  }

  /** Turns stall rows into public cards: 4 batched queries regardless of how many stalls. */
  private async describe(rows: StallRow[]): Promise<PublicStall[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [hours, active, prices, settings] = await Promise.all([
      this.db.select().from(stallHours).where(inArray(stallHours.stallId, ids)),
      this.db
        .select({ stallId: orders.stallId, n: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(inArray(orders.stallId, ids), inArray(orders.status, ['placed', 'preparing'])))
        .groupBy(orders.stallId),
      this.db
        .select({ stallId: menuItems.stallId, min: min(menuItems.pricePaise) })
        .from(menuItems)
        .where(
          and(inArray(menuItems.stallId, ids), eq(menuItems.isAvailable, true), isNull(menuItems.deletedAt)),
        )
        .groupBy(menuItems.stallId),
      getCurrentSettings(this.db),
    ]);
    const now = this.now();
    const thresholds = {
      lowMaxMinutes: settings.congestionLowMaxMinutes,
      moderateMaxMinutes: settings.congestionModerateMaxMinutes,
    };
    const base = this.options.publicImageBaseUrl.replace(/\/$/, '');

    return rows.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      description: s.description,
      location: s.location,
      photoUrl: s.photoKey ? `${base}/${s.photoKey}` : null,
      cuisineTags: s.cuisineTags,
      isVegOnly: s.isVegOnly,
      availability: availability(
        {
          status: s.status,
          isOpenOverride: s.isOpenOverride,
          acceptingOrders: s.acceptingOrders,
          hours: hours.filter((h) => h.stallId === s.id),
        },
        now,
      ),
      congestion: congestion(
        {
          activeOrders: active.find((a) => a.stallId === s.id)?.n ?? 0,
          avgPrepMinutes: s.avgPrepMinutes,
          parallelCapacity: s.parallelCapacity,
        },
        thresholds,
      ),
      // UPI needs an activated Razorpay Route account, whatever the toggle says (spec §6.2 V7).
      payments: { upi: s.upiEnabled && s.routeStatus === 'activated', cash: s.cashEnabled },
      startingPricePaise: prices.find((p) => p.stallId === s.id)?.min ?? null,
    }));
  }
}

function compareStalls(a: PublicStall, b: PublicStall): number {
  const byState = STATE_ORDER[a.availability.state] - STATE_ORDER[b.availability.state];
  if (byState !== 0) return byState;
  if (a.availability.state === 'open') {
    const byWait = a.congestion.waitMinutes - b.congestion.waitMinutes;
    if (byWait !== 0) return byWait;
  }
  if (a.availability.state === 'closed') {
    const an = a.availability.nextOpensAt?.getTime() ?? Infinity;
    const bn = b.availability.nextOpensAt?.getTime() ?? Infinity;
    if (an !== bn) return an - bn;
  }
  return a.name.localeCompare(b.name);
}

function trimSeconds(h: HoursSlot): HoursSlot {
  return { weekday: h.weekday, opensAt: h.opensAt.slice(0, 5), closesAt: h.closesAt.slice(0, 5) };
}

/**
 * Midnight job (IST): vendor "Open now"/"Close now" switches are for the day only, so every
 * stall goes back to following its opening hours. Returns the stalls that were reset.
 */
export async function resetStallOverrides(db: Db): Promise<string[]> {
  return db.transaction(async (tx) => {
    const reset = await tx
      .update(stalls)
      .set({ isOpenOverride: null })
      .where(isNotNull(stalls.isOpenOverride))
      .returning({ id: stalls.id });
    if (reset.length > 0) {
      await audit(tx, {
        actorId: null,
        action: 'stall.override.midnight_reset',
        entity: 'stall',
        after: { stallIds: reset.map((r) => r.id) },
      });
    }
    return reset.map((r) => r.id);
  });
}
