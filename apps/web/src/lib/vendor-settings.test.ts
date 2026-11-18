import { describe, expect, it } from 'vitest';
import { copyDayToAll, hoursProblems } from './vendor-settings';

describe('copyDayToAll', () => {
  it("gives every day the chosen day's slots", () => {
    const result = copyDayToAll(
      [
        { weekday: 1, opensAt: '08:00', closesAt: '14:00' },
        { weekday: 1, opensAt: '17:00', closesAt: '21:00' },
        { weekday: 3, opensAt: '10:00', closesAt: '12:00' },
      ],
      1,
    );
    expect(result).toHaveLength(14);
    expect(result.filter((s) => s.weekday === 7).map((s) => s.opensAt)).toEqual(['08:00', '17:00']);
  });
});

describe('hoursProblems', () => {
  it('flags empty, zero-length and overlapping slots', () => {
    const problems = hoursProblems([
      { weekday: 1, opensAt: '08:00', closesAt: '12:00' },
      { weekday: 1, opensAt: '11:00', closesAt: '15:00' },
      { weekday: 2, opensAt: '09:00', closesAt: '09:00' },
      { weekday: 3, opensAt: '', closesAt: '10:00' },
      { weekday: 4, opensAt: '18:00', closesAt: '01:00' },
    ]);
    expect([...problems.keys()]).toEqual([2, 3, 1]);
    expect(problems.get(1)).toMatch(/Overlaps/);
  });
});
