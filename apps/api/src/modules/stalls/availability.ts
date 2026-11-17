/**
 * Is a stall open right now, and how busy is it? (spec §10)
 * Pure functions with an explicit clock, so every case is unit-testable.
 *
 * Time zone: stall hours are Asia/Kolkata wall-clock times. India has no daylight saving,
 * so IST is always UTC+05:30 and a fixed offset is exact.
 */

const IST_OFFSET_MIN = 5 * 60 + 30;
const MIN_PER_DAY = 24 * 60;
const MS_PER_MIN = 60_000;

export interface HoursSlot {
  /** ISO weekday in IST: 1 = Monday … 7 = Sunday */
  weekday: number;
  /** "HH:MM" or "HH:MM:SS" (Postgres `time`) */
  opensAt: string;
  closesAt: string;
}

export interface StallState {
  status: 'draft' | 'active' | 'suspended';
  /** null = follow hours; true/false = forced open/closed by the vendor (reset at midnight). */
  isOpenOverride: boolean | null;
  acceptingOrders: boolean;
  hours: HoursSlot[];
}

export type AvailabilityState = 'open' | 'paused' | 'closed';

export interface Availability {
  state: AvailabilityState;
  /** Why: hours (schedule), override (vendor switch), paused, inactive (draft/suspended). */
  reason: 'hours' | 'override' | 'paused' | 'inactive';
  /** When the current slot ends (open by schedule), else null. */
  closesAt: Date | null;
  /** When the next slot starts (closed by schedule), else null. */
  nextOpensAt: Date | null;
}

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/** IST calendar position of a UTC instant. */
function istParts(now: Date) {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * MS_PER_MIN);
  const jsDay = ist.getUTCDay(); // 0 = Sunday
  return {
    weekday: jsDay === 0 ? 7 : jsDay,
    minute: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
    /** UTC ms of today's 00:00 IST */
    midnightMs:
      Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MIN * MS_PER_MIN,
  };
}

/** Weekday `offset` days after `weekday` (1–7, wrapping). */
const addDays = (weekday: number, offset: number) => ((((weekday - 1 + offset) % 7) + 7) % 7) + 1;

/** Is the schedule open at `now`? If yes, when does this slot end; if no, when is the next start. */
export function scheduleAt(
  hours: HoursSlot[],
  now: Date,
): { open: boolean; closesAt: Date | null; nextOpensAt: Date | null } {
  const { weekday, minute, midnightMs } = istParts(now);
  const at = (dayOffset: number, min: number) =>
    new Date(midnightMs + (dayOffset * MIN_PER_DAY + min) * MS_PER_MIN);

  // Open now? A slot can be today's (opens ≤ now < closes, or past-midnight from today's
  // evening), or yesterday's slot that runs past midnight into today.
  for (const slot of hours) {
    const opens = toMinutes(slot.opensAt);
    const closes = toMinutes(slot.closesAt);
    const overnight = closes <= opens;
    if (slot.weekday === weekday) {
      if (!overnight && minute >= opens && minute < closes)
        return { open: true, closesAt: at(0, closes), nextOpensAt: null };
      if (overnight && minute >= opens) return { open: true, closesAt: at(1, closes), nextOpensAt: null };
    }
    if (overnight && slot.weekday === addDays(weekday, -1) && minute < closes) {
      return { open: true, closesAt: at(0, closes), nextOpensAt: null };
    }
  }

  // Closed: the earliest slot start within the next 7 days.
  let next: Date | null = null;
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const day = addDays(weekday, dayOffset);
    for (const slot of hours) {
      if (slot.weekday !== day) continue;
      const opens = toMinutes(slot.opensAt);
      if (dayOffset === 0 && opens <= minute) continue;
      const candidate = at(dayOffset, opens);
      if (!next || candidate < next) next = candidate;
    }
    if (next) break;
  }
  return { open: false, closesAt: null, nextOpensAt: next };
}

export function availability(stall: StallState, now: Date): Availability {
  if (stall.status !== 'active')
    return { state: 'closed', reason: 'inactive', closesAt: null, nextOpensAt: null };

  let open: boolean;
  let reason: Availability['reason'];
  let closesAt: Date | null = null;
  let nextOpensAt: Date | null = null;
  if (stall.isOpenOverride !== null) {
    open = stall.isOpenOverride;
    reason = 'override';
  } else {
    const schedule = scheduleAt(stall.hours, now);
    ({ open, closesAt, nextOpensAt } = schedule);
    reason = 'hours';
  }

  if (!open) return { state: 'closed', reason, closesAt: null, nextOpensAt };
  if (!stall.acceptingOrders) return { state: 'paused', reason: 'paused', closesAt, nextOpensAt: null };
  return { state: 'open', reason, closesAt, nextOpensAt: null };
}

export type CongestionLevel = 'low' | 'moderate' | 'busy';

export interface CongestionInput {
  /** Orders the stall is still working on (placed + preparing). */
  activeOrders: number;
  avgPrepMinutes: number;
  parallelCapacity: number;
}

export interface CongestionThresholds {
  lowMaxMinutes: number;
  moderateMaxMinutes: number;
}

/**
 * Estimated wait for an order placed now = batches ahead of it, including itself, × prep time:
 *   ceil((active + 1) / capacity) × avgPrep
 * (Spec §10 writes ceil(active / capacity); counting the new order itself means an idle stall
 * shows its real prep time instead of "~0 min".)
 */
export function congestion(input: CongestionInput, thresholds: CongestionThresholds) {
  const capacity = Math.max(1, input.parallelCapacity);
  const waitMinutes =
    Math.ceil((Math.max(0, input.activeOrders) + 1) / capacity) * Math.max(1, input.avgPrepMinutes);
  const level: CongestionLevel =
    waitMinutes <= thresholds.lowMaxMinutes
      ? 'low'
      : waitMinutes <= thresholds.moderateMaxMinutes
        ? 'moderate'
        : 'busy';
  return { waitMinutes, level };
}
