import { describe, expect, it } from 'vitest';
import { moved } from './vendor-menu';

describe('moved', () => {
  it('swaps an element with its neighbour', () => {
    expect(moved(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moved(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
  });
  it('leaves the list alone at the ends', () => {
    const list = ['a', 'b'];
    expect(moved(list, 0, -1)).toBe(list);
    expect(moved(list, 1, 1)).toBe(list);
  });
});
