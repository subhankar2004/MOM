import { describe, expect, it } from 'vitest';
import { checklistDone, parseTags } from './admin-stalls';

describe('parseTags', () => {
  it('splits, trims, drops blanks and duplicates, keeps at most 6', () => {
    expect(parseTags(' Dosa, South Indian ,, Dosa ')).toEqual(['Dosa', 'South Indian']);
    expect(parseTags('a,b,c,d,e,f,g')).toHaveLength(6);
    expect(parseTags('')).toEqual([]);
  });
});

describe('checklistDone', () => {
  it('counts the finished items', () => {
    expect(checklistDone({ menu: true, hours: false, photo: true, payments: true, owner: false })).toBe(3);
  });
});
