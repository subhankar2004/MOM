import { describe, expect, it } from 'vitest';
import { auditDiff, bpsToPercent, feePreview, percentToBps } from './admin-platform';

describe('fee percentages', () => {
  it('converts percentages to basis points and back', () => {
    expect(percentToBps('1')).toBe(100);
    expect(percentToBps('1.5')).toBe(150);
    expect(percentToBps('0.25')).toBe(25);
    expect(percentToBps('abc')).toBeNull();
    expect(percentToBps('1.234')).toBeNull();
    expect(bpsToPercent(100)).toBe('1');
    expect(bpsToPercent(150)).toBe('1.5');
    expect(bpsToPercent(25)).toBe('0.25');
  });

  it('previews the bill on ₹100', () => {
    expect(feePreview(100, 500)).toEqual({
      upi: { subtotalPaise: 10000, platformFeePaise: 100, cashFeePaise: 0, totalPaise: 10100 },
      cash: { subtotalPaise: 10000, platformFeePaise: 100, cashFeePaise: 500, totalPaise: 10600 },
    });
  });
});

describe('auditDiff', () => {
  it('lists every field in before or after', () => {
    expect(auditDiff({ fee: 100, a: 'x' }, { fee: 200, b: true })).toEqual([
      { field: 'fee', before: '100', after: '200' },
      { field: 'a', before: 'x', after: '—' },
      { field: 'b', before: '—', after: 'true' },
    ]);
    expect(auditDiff(null, null)).toEqual([]);
  });
});
