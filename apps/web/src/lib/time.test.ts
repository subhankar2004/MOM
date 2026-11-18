import { describe, expect, it } from 'vitest';
import { closingSoonLabel, elapsedLabel, formatTime, opensLabel, orderDateLabel } from './time';

const ist = (wallClock: string) => new Date(`${wallClock.replace(' ', 'T')}:00+05:30`);

describe('formatTime (IST)', () => {
  it.each([
    ['2026-11-16 07:30', '7:30 AM'],
    ['2026-11-16 17:00', '5 PM'],
    ['2026-11-16 00:00', '12 AM'],
    ['2026-11-16 12:05', '12:05 PM'],
  ])('%s → %s', (wall, expected) => {
    expect(formatTime(ist(wall))).toBe(expected);
  });

  it('uses India time regardless of the UTC instant', () => {
    expect(formatTime(new Date('2026-11-16T02:00:00Z'))).toBe('7:30 AM');
  });
});

describe('opensLabel', () => {
  const now = ist('2026-11-16 23:00'); // Monday night
  it('later today', () => expect(opensLabel(ist('2026-11-16 23:30'), now)).toBe('Opens 11:30 PM'));
  it('tomorrow', () => expect(opensLabel(ist('2026-11-17 07:30'), now)).toBe('Opens tomorrow 7:30 AM'));
  it('later this week', () => expect(opensLabel(ist('2026-11-19 11:30'), now)).toBe('Opens Thu 11:30 AM'));
  it('closed by the stall for today', () => expect(opensLabel(null, now)).toBe('Closed for today'));
  it('day boundary is IST midnight, not UTC', () => {
    // 01:00 IST Tuesday is still Monday in UTC, but for a student it's "today" vs Monday 23:00 → tomorrow
    expect(opensLabel(ist('2026-11-17 01:00'), now)).toBe('Opens tomorrow 1 AM');
  });
});

describe('closingSoonLabel', () => {
  const now = ist('2026-11-16 21:10');
  it('within the hour', () =>
    expect(closingSoonLabel(ist('2026-11-16 21:30'), now)).toBe('Closes in 20 min'));
  it('later than an hour', () => expect(closingSoonLabel(ist('2026-11-16 23:30'), now)).toBeNull());
  it('no closing time', () => expect(closingSoonLabel(null, now)).toBeNull());
});

describe('orderDateLabel', () => {
  const now = new Date('2026-11-18T14:00:00+05:30');
  it('today, yesterday, then a date — in India time', () => {
    expect(orderDateLabel(new Date('2026-11-18T13:05:00+05:30'), now)).toBe('Today, 1:05 PM');
    expect(orderDateLabel(new Date('2026-11-17T20:00:00+05:30'), now)).toBe('Yesterday, 8 PM');
    // 23:30 IST on the 12th is still the 12th in India even though it's the 12th 18:00 UTC.
    expect(orderDateLabel(new Date('2026-11-12T23:30:00+05:30'), now)).toBe('12 Nov, 11:30 PM');
  });
});

describe('elapsedLabel', () => {
  const at = new Date('2026-11-18T12:00:00Z');
  const after = (ms: number) => new Date(at.getTime() + ms);
  it('minutes, then hours and minutes', () => {
    expect(elapsedLabel(at, after(20_000))).toBe('Just now');
    expect(elapsedLabel(at, after(4 * 60_000 + 59_000))).toBe('4 min');
    expect(elapsedLabel(at, after(65 * 60_000))).toBe('1 h 5 min');
    expect(elapsedLabel(at, after(120 * 60_000))).toBe('2 h');
    expect(elapsedLabel(at, after(-5000))).toBe('Just now'); // device clock slightly behind
  });
});
