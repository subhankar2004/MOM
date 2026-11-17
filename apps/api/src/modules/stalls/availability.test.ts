import { describe, expect, it } from 'vitest';
import { availability, congestion, scheduleAt, type HoursSlot, type StallState } from './availability.js';

/** A UTC instant from an IST wall-clock time, e.g. ist('2026-11-16 08:00') (a Monday). */
const ist = (wallClock: string) => new Date(`${wallClock.replace(' ', 'T')}:00+05:30`);
const iso = (d: Date | null) => d?.toISOString() ?? null;
const istIso = (wallClock: string) => ist(wallClock).toISOString();

// 2026-11-16 is a Monday, 2026-11-22 a Sunday.
const everyDay = (opensAt: string, closesAt: string): HoursSlot[] =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opensAt, closesAt }));

const DOSA = everyDay('07:30', '21:30');
// Lunch + dinner, closed Sunday (like the seeded Odia Thali Ghar)
const THALI: HoursSlot[] = [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
  { weekday, opensAt: '11:30:00', closesAt: '15:30:00' },
  { weekday, opensAt: '19:00:00', closesAt: '22:00:00' },
]);
// Morning slot + an evening slot that runs past midnight
const CHAI: HoursSlot[] = [...everyDay('07:00', '10:00'), ...everyDay('17:00', '01:00')];

const stall = (hours: HoursSlot[], over: Partial<StallState> = {}): StallState => ({
  status: 'active',
  isOpenOverride: null,
  acceptingOrders: true,
  hours,
  ...over,
});

describe('scheduleAt — opening hours in IST', () => {
  it('open during a slot, with its closing time', () => {
    const r = scheduleAt(DOSA, ist('2026-11-16 12:00'));
    expect(r.open).toBe(true);
    expect(iso(r.closesAt)).toBe(istIso('2026-11-16 21:30'));
  });

  it('opening and closing minutes: opens at 07:30 sharp, closed at 21:30 sharp', () => {
    expect(scheduleAt(DOSA, ist('2026-11-16 07:29')).open).toBe(false);
    expect(scheduleAt(DOSA, ist('2026-11-16 07:30')).open).toBe(true);
    expect(scheduleAt(DOSA, ist('2026-11-16 21:29')).open).toBe(true);
    expect(scheduleAt(DOSA, ist('2026-11-16 21:30')).open).toBe(false);
  });

  it('closed before opening → opens later today', () => {
    const r = scheduleAt(DOSA, ist('2026-11-16 06:00'));
    expect(r).toEqual({ open: false, closesAt: null, nextOpensAt: ist('2026-11-16 07:30') });
  });

  it('closed after closing → opens tomorrow', () => {
    expect(iso(scheduleAt(DOSA, ist('2026-11-16 23:00')).nextOpensAt)).toBe(istIso('2026-11-17 07:30'));
  });

  it('between two slots → opens at the next slot today', () => {
    const r = scheduleAt(THALI, ist('2026-11-16 16:00'));
    expect(r.open).toBe(false);
    expect(iso(r.nextOpensAt)).toBe(istIso('2026-11-16 19:00'));
    expect(scheduleAt(THALI, ist('2026-11-16 20:00')).open).toBe(true);
  });

  it('closed all Sunday → opens Monday lunch', () => {
    const r = scheduleAt(THALI, ist('2026-11-22 12:00'));
    expect(r.open).toBe(false);
    expect(iso(r.nextOpensAt)).toBe(istIso('2026-11-23 11:30'));
  });

  it('slot past midnight: open late at night, closes at 01:00 next day', () => {
    const r = scheduleAt(CHAI, ist('2026-11-16 23:45'));
    expect(r.open).toBe(true);
    expect(iso(r.closesAt)).toBe(istIso('2026-11-17 01:00'));
  });

  it("slot past midnight: still open at 00:30 thanks to yesterday's slot", () => {
    const r = scheduleAt(CHAI, ist('2026-11-17 00:30'));
    expect(r.open).toBe(true);
    expect(iso(r.closesAt)).toBe(istIso('2026-11-17 01:00'));
  });

  it('slot past midnight: closed at 01:00, next opens 07:00', () => {
    const r = scheduleAt(CHAI, ist('2026-11-17 01:00'));
    expect(r.open).toBe(false);
    expect(iso(r.nextOpensAt)).toBe(istIso('2026-11-17 07:00'));
  });

  it('overnight slot on Sunday carries into Monday morning (week wrap)', () => {
    const sundayNight: HoursSlot[] = [{ weekday: 7, opensAt: '20:00', closesAt: '02:00' }];
    expect(scheduleAt(sundayNight, ist('2026-11-23 01:30')).open).toBe(true); // Monday 01:30
    expect(scheduleAt(sundayNight, ist('2026-11-23 02:00')).open).toBe(false);
    expect(iso(scheduleAt(sundayNight, ist('2026-11-23 02:00')).nextOpensAt)).toBe(
      istIso('2026-11-29 20:00'),
    );
  });

  it('a slot ending at midnight (closes 00:00)', () => {
    const late: HoursSlot[] = everyDay('18:00', '00:00');
    const r = scheduleAt(late, ist('2026-11-16 23:59'));
    expect(r.open).toBe(true);
    expect(iso(r.closesAt)).toBe(istIso('2026-11-17 00:00'));
    expect(scheduleAt(late, ist('2026-11-17 00:00')).open).toBe(false);
  });

  it('no hours at all → closed with no next opening', () => {
    expect(scheduleAt([], ist('2026-11-16 12:00'))).toEqual({
      open: false,
      closesAt: null,
      nextOpensAt: null,
    });
  });

  it('IST, not UTC: 23:00 UTC Monday is already Tuesday 04:30 in India', () => {
    const r = scheduleAt(DOSA, new Date('2026-11-16T23:00:00Z'));
    expect(r.open).toBe(false);
    expect(iso(r.nextOpensAt)).toBe(istIso('2026-11-17 07:30'));
  });
});

describe('availability — schedule, vendor switches, pause', () => {
  const noon = ist('2026-11-16 12:00');
  const night = ist('2026-11-16 23:00');

  it('open by schedule', () => {
    expect(availability(stall(DOSA), noon)).toEqual({
      state: 'open',
      reason: 'hours',
      closesAt: ist('2026-11-16 21:30'),
      nextOpensAt: null,
    });
  });

  it('closed by schedule', () => {
    expect(availability(stall(DOSA), night)).toMatchObject({ state: 'closed', reason: 'hours' });
  });

  it('vendor "Open now" overrides the schedule', () => {
    expect(availability(stall(DOSA, { isOpenOverride: true }), night)).toMatchObject({
      state: 'open',
      reason: 'override',
    });
  });

  it('vendor "Close now" overrides the schedule', () => {
    expect(availability(stall(DOSA, { isOpenOverride: false }), noon)).toEqual({
      state: 'closed',
      reason: 'override',
      closesAt: null,
      nextOpensAt: null,
    });
  });

  it('paused: open but not taking orders', () => {
    expect(availability(stall(DOSA, { acceptingOrders: false }), noon)).toMatchObject({
      state: 'paused',
      reason: 'paused',
    });
  });

  it('paused does not matter when closed', () => {
    expect(availability(stall(DOSA, { acceptingOrders: false }), night).state).toBe('closed');
  });

  it.each(['draft', 'suspended'] as const)('a %s stall is always closed', (status) => {
    expect(availability(stall(DOSA, { status, isOpenOverride: true }), noon)).toMatchObject({
      state: 'closed',
      reason: 'inactive',
    });
  });
});

describe('congestion — wait estimate and meter level', () => {
  const thresholds = { lowMaxMinutes: 10, moderateMaxMinutes: 20 };

  it('idle stall: wait is one prep time (not "0 min")', () => {
    expect(congestion({ activeOrders: 0, avgPrepMinutes: 8, parallelCapacity: 3 }, thresholds)).toEqual({
      waitMinutes: 8,
      level: 'low',
    });
  });

  it('low: queue fits in the first batch', () => {
    expect(congestion({ activeOrders: 2, avgPrepMinutes: 8, parallelCapacity: 3 }, thresholds)).toEqual({
      waitMinutes: 8,
      level: 'low',
    });
  });

  it('moderate: two batches ahead', () => {
    expect(congestion({ activeOrders: 3, avgPrepMinutes: 8, parallelCapacity: 3 }, thresholds)).toEqual({
      waitMinutes: 16,
      level: 'moderate',
    });
  });

  it('busy: long queue', () => {
    expect(congestion({ activeOrders: 9, avgPrepMinutes: 8, parallelCapacity: 3 }, thresholds)).toEqual({
      waitMinutes: 32,
      level: 'busy',
    });
  });

  it('thresholds are inclusive and configurable', () => {
    expect(congestion({ activeOrders: 0, avgPrepMinutes: 10, parallelCapacity: 1 }, thresholds).level).toBe(
      'low',
    );
    expect(congestion({ activeOrders: 1, avgPrepMinutes: 10, parallelCapacity: 1 }, thresholds).level).toBe(
      'moderate',
    );
    expect(
      congestion(
        { activeOrders: 1, avgPrepMinutes: 10, parallelCapacity: 1 },
        { lowMaxMinutes: 25, moderateMaxMinutes: 40 },
      ).level,
    ).toBe('low');
  });

  it('guards against nonsense input', () => {
    expect(congestion({ activeOrders: -5, avgPrepMinutes: 0, parallelCapacity: 0 }, thresholds)).toEqual({
      waitMinutes: 1,
      level: 'low',
    });
  });
});
