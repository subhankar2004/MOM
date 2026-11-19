import { describe, expect, it } from 'vitest';
import { statementCsv, statementPeriod, type Statement } from './admin-settlements';

// Thursday 19 Nov 2026, 10:00 IST
const NOW = new Date('2026-11-19T04:30:00Z');

describe('statementPeriod', () => {
  it('uses Monday–Sunday weeks in India time', () => {
    expect(statementPeriod('last_week', NOW)).toEqual({ from: '2026-11-09', to: '2026-11-15' });
    expect(statementPeriod('this_week', NOW)).toEqual({ from: '2026-11-16', to: '2026-11-19' });
    expect(statementPeriod('this_month', NOW)).toEqual({ from: '2026-11-01', to: '2026-11-19' });
  });
  it('treats Monday as the first day of the week', () => {
    const monday = new Date('2026-11-16T04:30:00Z');
    expect(statementPeriod('last_week', monday)).toEqual({ from: '2026-11-09', to: '2026-11-15' });
  });
});

describe('statementCsv', () => {
  it('writes opening, lines with running balance, and closing', () => {
    const csv = statementCsv({
      stall: { id: 'x', name: 'Dosa Corner' },
      period: { from: '2026-11-09', to: '2026-11-15' },
      openingPaise: 0,
      lines: [
        {
          at: '2026-11-10T08:00:00.000Z',
          kind: 'cash_order_fees',
          description: 'MOM fees on cash token #3 (2026-11-10)',
          amountPaise: 720,
          balancePaise: 720,
          orderId: 'o',
        },
        {
          at: '2026-11-14T08:00:00.000Z',
          kind: 'settlement',
          description: 'Cash paid to MOM',
          amountPaise: -720,
          balancePaise: 0,
          orderId: null,
        },
      ],
      closingPaise: 0,
    } as Statement);
    expect(csv.split('\r\n')).toEqual([
      '﻿Date,Description,Amount (₹),Balance owed to MOM (₹)',
      '2026-11-09,Opening balance,,0.00',
      '2026-11-10,MOM fees on cash token #3 (2026-11-10),7.20,7.20',
      '2026-11-14,Cash paid to MOM,-7.20,0.00',
      '2026-11-15,Closing balance,,0.00',
      '',
    ]);
  });
});
