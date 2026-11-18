import { describe, expect, it } from 'vitest';
import { fitWithin } from './image-compress';

describe('fitWithin', () => {
  it('scales the longest side down to 1200 px, keeping the shape', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1200, height: 900 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 900, height: 1200 });
  });
  it('never scales small photos up', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it('keeps at least 1 px on very thin images', () => {
    expect(fitWithin(12000, 3)).toEqual({ width: 1200, height: 1 });
  });
});
