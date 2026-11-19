import { describe, expect, it } from 'vitest';
import { presetPeriod, revenueByPeriodCsv, revenueByStallCsv, type Revenue } from './admin-finance';

// 19 Nov 2026, 23:00 IST
const NOW = new Date('2026-11-19T17:30:00Z');

describe('presetPeriod', () => {
  it('gives India-date ranges for the quick views', () => {
    expect(presetPeriod('30d', NOW)).toEqual({ from: '2026-10-21', to: '2026-11-19', group: 'day' });
    expect(presetPeriod('12w', NOW)).toEqual({ from: '2026-08-28', to: '2026-11-19', group: 'week' });
    expect(presetPeriod('12m', NOW)).toEqual({ from: '2025-12-01', to: '2026-11-19', group: 'month' });
  });
});

const revenue: Revenue = {
  period: { from: '2026-11-01', to: '2026-11-02', group: 'day' },
  totals: {
    platformFeesPaise: 360,
    cashFeesPaise: 600,
    refundedPaise: 120,
    adjustmentsPaise: 0,
    netPaise: 840,
  },
  series: [
    { bucket: '2026-11-01', platformFeesPaise: 120, cashFeesPaise: 0, netPaise: 120 },
    { bucket: '2026-11-02', platformFeesPaise: 240, cashFeesPaise: 600, netPaise: 720 },
  ],
  byStall: [
    {
      stallId: 'a',
      stallName: 'Chai, Rolls & More',
      orders: 2,
      orderValuePaise: 24840,
      platformFeesPaise: 360,
      cashFeesPaise: 600,
      refundedPaise: 120,
      netPaise: 840,
    },
  ],
  mix: { upi: { orders: 1, valuePaise: 12120 }, cash: { orders: 1, valuePaise: 12720 } },
};

describe('revenue CSVs', () => {
  it('writes commission per stall with a total, quoting names with commas', () => {
    expect(revenueByStallCsv(revenue).split('\r\n')).toEqual([
      '﻿Stall,Orders,Order value (₹),Platform fees (₹),Cash fees (₹),Refunded (₹),MOM revenue (₹)',
      '"Chai, Rolls & More",2,248.40,3.60,6.00,1.20,8.40',
      'Total,2,248.40,3.60,6.00,1.20,8.40',
      '',
    ]);
  });
  it('writes one row per period', () => {
    expect(revenueByPeriodCsv(revenue).split('\r\n').slice(1, 3)).toEqual([
      '2026-11-01,1.20,0.00,1.20',
      '2026-11-02,2.40,6.00,7.20',
    ]);
  });
});
