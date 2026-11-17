import { describe, expect, it } from 'vitest';
import { calcFees, DEFAULT_FEE_RATES, feeFromBps, formatBps, formatINR, MAX_PAISE, paise } from './money.js';

describe('calcFees — spec §4.1 examples', () => {
  it('₹130 by UPI → ₹131.30 (1% platform fee only)', () => {
    expect(calcFees(paise(130), 'upi', DEFAULT_FEE_RATES)).toEqual({
      subtotalPaise: 13000,
      platformFeePaise: 130,
      cashFeePaise: 0,
      totalPaise: 13130,
    });
  });

  it('₹130 in cash → ₹137.80 (1% platform + 5% cash fee)', () => {
    expect(calcFees(paise(130), 'cash', DEFAULT_FEE_RATES)).toEqual({
      subtotalPaise: 13000,
      platformFeePaise: 130,
      cashFeePaise: 650,
      totalPaise: 13780,
    });
  });

  it('rounds each fee separately (₹99.99 cash)', () => {
    // 1% of 9999 = 99.99 → 100 ; 5% of 9999 = 499.95 → 500
    expect(calcFees(9999, 'cash', DEFAULT_FEE_RATES)).toEqual({
      subtotalPaise: 9999,
      platformFeePaise: 100,
      cashFeePaise: 500,
      totalPaise: 10599,
    });
  });

  it('total always equals subtotal + fees', () => {
    for (let subtotal = 0; subtotal <= 50_000; subtotal += 37) {
      for (const method of ['upi', 'cash'] as const) {
        const b = calcFees(subtotal, method, DEFAULT_FEE_RATES);
        expect(b.totalPaise).toBe(b.subtotalPaise + b.platformFeePaise + b.cashFeePaise);
        if (method === 'upi') expect(b.cashFeePaise).toBe(0);
      }
    }
  });

  it('uses the rates it is given (fees are configurable)', () => {
    expect(calcFees(10000, 'cash', { platformFeeBps: 0, cashFeeBps: 250 })).toMatchObject({
      platformFeePaise: 0,
      cashFeePaise: 250,
      totalPaise: 10250,
    });
  });

  it('rejects bad input', () => {
    expect(() => calcFees(-1, 'upi', DEFAULT_FEE_RATES)).toThrow(RangeError);
    expect(() => calcFees(10.5, 'upi', DEFAULT_FEE_RATES)).toThrow(RangeError);
    expect(() => calcFees(MAX_PAISE + 1, 'upi', DEFAULT_FEE_RATES)).toThrow(RangeError);
    expect(() => calcFees(100, 'card' as never, DEFAULT_FEE_RATES)).toThrow(/payment method/);
    expect(() => calcFees(100, 'upi', { platformFeeBps: 1.5, cashFeeBps: 0 })).toThrow(RangeError);
    expect(() => calcFees(100, 'upi', { platformFeeBps: 10_001, cashFeeBps: 0 })).toThrow(RangeError);
  });
});

describe('feeFromBps — half-up rounding', () => {
  it.each([
    [50, 100, 1], // 0.50 → 1 (half rounds up)
    [49, 100, 0], // 0.49 → 0
    [149, 100, 1], // 1.49 → 1
    [150, 100, 2], // 1.50 → 2
    [10, 500, 1], // 0.50 → 1
    [9, 500, 0], // 0.45 → 0
    [0, 500, 0],
    [12345, 0, 0],
    [12345, 10_000, 12345], // 100 %
    [MAX_PAISE, 500, 50_000_000], // no overflow at the upper bound
  ])('%i paise at %i bps → %i', (amount, bps, expected) => {
    expect(feeFromBps(amount, bps)).toBe(expected);
  });
});

describe('paise', () => {
  it.each([
    [130, 13000],
    [137.8, 13780],
    ['137.80', 13780],
    ['0.05', 5],
    [' 80 ', 8000],
    [0, 0],
    [0.1 + 0.2, null], // 0.30000000000000004 has too many decimals → rejected, not silently rounded
  ])('%s → %s', (input, expected) => {
    if (expected === null) expect(() => paise(input)).toThrow(RangeError);
    else expect(paise(input)).toBe(expected);
  });

  it.each(['', 'abc', '-5', '1.234', '1,000', '1e3', '₹100', String(Number.MAX_SAFE_INTEGER)])(
    'rejects %j',
    (input) => {
      expect(() => paise(input)).toThrow(RangeError);
    },
  );
});

describe('formatINR', () => {
  it.each([
    [13780, '₹137.80'],
    [13000, '₹130.00'],
    [5, '₹0.05'],
    [0, '₹0.00'],
    [10_000_000, '₹1,00,000.00'], // Indian lakh grouping
    [-650, '-₹6.50'],
  ])('%i → %s', (amount, expected) => {
    expect(formatINR(amount)).toBe(expected);
  });

  it('compact drops .00 only for whole rupees', () => {
    expect(formatINR(8000, { compact: true })).toBe('₹80');
    expect(formatINR(13780, { compact: true })).toBe('₹137.80');
  });

  it('rejects non-integer paise', () => {
    expect(() => formatINR(1.5)).toThrow(RangeError);
  });
});

describe('formatBps', () => {
  it('formats rates', () => {
    expect(formatBps(100)).toBe('1%');
    expect(formatBps(500)).toBe('5%');
    expect(formatBps(250)).toBe('2.5%');
  });
});
