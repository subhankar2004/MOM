'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api-client';

export interface StallReport {
  period: { from: string; to: string };
  orders: { collected: number; upi: number; cash: number; rejected: number; cancelled: number };
  sales: { grossPaise: number; upiPaise: number; cashPaise: number; cashTakenPaise: number };
  fees: {
    platformFeesPaise: number;
    cashFeesPaise: number;
    refundedPaise: number;
    adjustmentsPaise: number;
    netPaise: number;
  };
  dues: { owedPaise: number; settledPaise: number; outstandingPaise: number };
  payouts: { upiDuePaise: number; transfersReceivedPaise: number };
  daily: Array<{
    day: string;
    orders: number;
    grossPaise: number;
    upiPaise: number;
    cashPaise: number;
    feesPaise: number;
  }>;
}

export type ReportView = 'today' | 'week' | 'month';

/** India date (YYYY-MM-DD) of an instant, `offsetDays` later. */
function istDate(now: Date, offsetDays = 0): string {
  return new Date(now.getTime() + 330 * 60_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** Today; the last 7 days including today; or this month so far (India dates). */
export function periodFor(view: ReportView, now: Date): { from: string; to: string } {
  const to = istDate(now);
  if (view === 'today') return { from: to, to };
  if (view === 'week') return { from: istDate(now, -6), to };
  return { from: `${to.slice(0, 8)}01`, to };
}

export function useStallReport(stallId: string, period: { from: string; to: string }) {
  return useQuery({
    queryKey: ['vendor', 'report', stallId, period.from, period.to],
    queryFn: () =>
      apiRequest<StallReport>(
        `/v1/vendor/stalls/${encodeURIComponent(stallId)}/reports?from=${period.from}&to=${period.to}`,
      ),
    // Today's numbers move as orders are handed over.
    refetchInterval: 60_000,
  });
}

const rupees = (paise: number) => (paise / 100).toFixed(2);

/** One row per day plus a total, in rupees (opens in Excel / Google Sheets). */
export function reportCsv(r: StallReport): string {
  const header = ['Date', 'Orders', 'Sales (₹)', 'UPI (₹)', 'Cash (₹)', 'MOM fees (₹)'];
  const rows = r.daily.map((d) => [
    d.day,
    String(d.orders),
    rupees(d.grossPaise),
    rupees(d.upiPaise),
    rupees(d.cashPaise),
    rupees(d.feesPaise),
  ]);
  rows.push([
    'Total',
    String(r.orders.collected),
    rupees(r.sales.grossPaise),
    rupees(r.sales.upiPaise),
    rupees(r.sales.cashPaise),
    rupees(r.fees.netPaise),
  ]);
  // Excel needs the BOM to read "₹" correctly.
  return '﻿' + [header, ...rows].map((cols) => cols.join(',')).join('\r\n') + '\r\n';
}
