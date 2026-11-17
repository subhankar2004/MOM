import { describe, expect, it } from 'vitest';
import { matchStall, normalize, type PublicStall } from './stalls';

const stall = (over: Partial<PublicStall> = {}): PublicStall => ({
  id: '1',
  slug: 'dosa-corner',
  name: 'Dosa Corner',
  description: null,
  location: 'Near Main Gate',
  photoUrl: null,
  cuisineTags: ['South Indian', 'Breakfast'],
  isVegOnly: true,
  availability: { state: 'open', reason: 'hours', closesAt: null, nextOpensAt: null },
  congestion: { level: 'low', waitMinutes: 8 },
  payments: { upi: true, cash: true },
  startingPricePaise: 3000,
  dishes: ['Plain Dosa', 'Masala Dosa', 'Idli (2 pcs)', 'Filter Coffee'],
  ...over,
});

describe('matchStall', () => {
  it('empty search matches everything', () => {
    expect(matchStall(stall(), '  ')).toEqual({ matches: true, dishes: [] });
  });
  it('matches the stall name, cuisine and location, case-insensitively', () => {
    expect(matchStall(stall(), 'dosa CORNER').matches).toBe(true);
    expect(matchStall(stall(), 'south indian').matches).toBe(true);
    expect(matchStall(stall(), 'main gate').matches).toBe(true);
  });
  it('matches dishes and says which', () => {
    expect(matchStall(stall({ name: 'Tiffin Point' }), 'coffee')).toEqual({
      matches: true,
      dishes: ['Filter Coffee'],
    });
    expect(matchStall(stall(), 'dosa').dishes).toEqual(['Plain Dosa', 'Masala Dosa']);
  });
  it('no match', () => {
    expect(matchStall(stall(), 'biryani')).toEqual({ matches: false, dishes: [] });
  });
});

describe('normalize', () => {
  it('ignores case, accents and extra spaces', () => {
    expect(normalize('  Café   AU  Lait ')).toBe('cafe au lait');
  });
});
