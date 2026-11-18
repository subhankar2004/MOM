import { describe, expect, it } from 'vitest';
import { periodFor, reportCsv, type StallReport } from './vendor-reports';

// 18 Nov 2026, 23:30 IST (18:00 UTC): still the 18th in India.
const NOW = new Date('2026-11-18T18:00:00Z');

describe('periodFor', () => {
  it('uses India dates', () => {
    expect(periodFor('today', NOW)).toEqual({ from: '2026-11-18', to: '2026-11-18' });
    expect(periodFor('today', new Date('2026-11-18T18:31:00Z'))).toEqual({
      from: '2026-11-19',
      to: '2026-11-19',
    });
  });
  it('gives the last 7 days and the month so far', () => {
    expect(periodFor('week', NOW)).toEqual({ from: '2026-11-12', to: '2026-11-18' });
    expect(periodFor('month', NOW)).toEqual({ from: '2026-11-01', to: '2026-11-18' });
  });
});

describe('reportCsv', () => {
  it('writes a row per day and a total, in rupees', () => {
    const csv = reportCsv({
      orders: { collected: 3, upi: 2, cash: 1, rejected: 0, cancelled: 0 },
      sales: { grossPaise: 36000, upiPaise: 24000, cashPaise: 12000, cashTakenPaise: 12720 },
      fees: {
        platformFeesPaise: 360,
        cashFeesPaise: 600,
        refundedPaise: 0,
        adjustmentsPaise: 0,
        netPaise: 960,
      },
      daily: [
        { day: '2026-11-17', orders: 1, grossPaise: 12000, upiPaise: 12000, cashPaise: 0, feesPaise: 120 },
        {
          day: '2026-11-18',
          orders: 2,
          grossPaise: 24000,
          upiPaise: 12000,
          cashPaise: 12000,
          feesPaise: 840,
        },
      ],
    } as StallReport);
    expect(csv.split('\r\n')).toEqual([
      '﻿Date,Orders,Sales (₹),UPI (₹),Cash (₹),MOM fees (₹)',
      '2026-11-17,1,120.00,120.00,0.00,1.20',
      '2026-11-18,2,240.00,120.00,120.00,8.40',
      'Total,3,360.00,240.00,120.00,9.60',
      '',
    ]);
  });
});
