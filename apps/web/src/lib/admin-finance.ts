'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api-client';

export interface Overview {
  day: string;
  today: {
    orders: number;
    collected: number;
    upiOrders: number;
    cashOrders: number;
    orderValuePaise: number;
    revenuePaise: number;
    failedPayments: number;
  };
  live: { placed: number; preparing: number; ready: number };
  stalls: { active: number; openNow: number; draft: number; payoutsInReview: number };
  attention: { refundPending: number };
  reconciliation: { ranAt: string; status: 'ok' | 'mismatch'; errors: number; warnings: number } | null;
}

export type Grouping = 'day' | 'week' | 'month';

export interface Revenue {
  period: { from: string; to: string; group: Grouping };
  totals: {
    platformFeesPaise: number;
    cashFeesPaise: number;
    refundedPaise: number;
    adjustmentsPaise: number;
    netPaise: number;
  };
  series: Array<{ bucket: string; platformFeesPaise: number; cashFeesPaise: number; netPaise: number }>;
  byStall: Array<{
    stallId: string;
    stallName: string;
    orders: number;
    orderValuePaise: number;
    platformFeesPaise: number;
    cashFeesPaise: number;
    refundedPaise: number;
    netPaise: number;
  }>;
  mix: { upi: { orders: number; valuePaise: number }; cash: { orders: number; valuePaise: number } };
}

export interface ReconciliationRun {
  id: number;
  ranAt: string;
  periodStart: string;
  periodEnd: string;
  ordersChecked: number;
  status: 'ok' | 'mismatch';
  issues: Array<{
    kind: string;
    severity: 'error' | 'warning';
    orderId: string;
    message: string;
  }>;
  startedBy: string | null;
}

export function useOverview() {
  return useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => apiRequest<Overview>('/v1/admin/overview'),
    refetchInterval: 30_000,
  });
}

export function useRevenue(period: { from: string; to: string; group: Grouping }) {
  return useQuery({
    queryKey: ['admin', 'revenue', period],
    queryFn: () =>
      apiRequest<Revenue>(`/v1/admin/revenue?from=${period.from}&to=${period.to}&group=${period.group}`),
    placeholderData: (previous) => previous,
  });
}

export function useReconciliationRuns() {
  return useQuery({
    queryKey: ['admin', 'reconciliation'],
    queryFn: () => apiRequest<{ runs: ReconciliationRun[] }>('/v1/admin/reconciliation'),
    select: (d) => d.runs,
  });
}

export function useRunReconciliation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (days: number) =>
      apiRequest<{ run: ReconciliationRun }>('/v1/admin/reconciliation/run', {
        method: 'POST',
        body: { days },
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'reconciliation'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] });
    },
  });
}

/** India date `offset` days from `now`. */
export function istDate(now: Date, offset = 0): string {
  return new Date(now.getTime() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10);
}

export type Preset = '30d' | '12w' | '12m';

/** The revenue page's quick ranges, in India dates. */
export function presetPeriod(preset: Preset, now: Date): { from: string; to: string; group: Grouping } {
  const to = istDate(now);
  if (preset === '30d') return { from: istDate(now, -29), to, group: 'day' };
  if (preset === '12w') return { from: istDate(now, -7 * 12 + 1), to, group: 'week' };
  const [y, m] = to.split('-').map(Number) as [number, number];
  const start = new Date(Date.UTC(y, m - 1 - 11, 1)).toISOString().slice(0, 10);
  return { from: start, to, group: 'month' };
}

const rupees = (paise: number) => (paise / 100).toFixed(2);
const csvCell = (text: string) => (/[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
const toCsv = (rows: string[][]) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** Commission per stall plus a total row, in rupees (Excel / Google Sheets). */
export function revenueByStallCsv(r: Revenue): string {
  const rows = r.byStall.map((s) => [
    s.stallName,
    String(s.orders),
    rupees(s.orderValuePaise),
    rupees(s.platformFeesPaise),
    rupees(s.cashFeesPaise),
    rupees(s.refundedPaise),
    rupees(s.netPaise),
  ]);
  const sum = (k: 'orders' | 'orderValuePaise') => r.byStall.reduce((t, s) => t + s[k], 0);
  return toCsv([
    [
      'Stall',
      'Orders',
      'Order value (₹)',
      'Platform fees (₹)',
      'Cash fees (₹)',
      'Refunded (₹)',
      'MOM revenue (₹)',
    ],
    ...rows,
    [
      'Total',
      String(sum('orders')),
      rupees(sum('orderValuePaise')),
      rupees(r.totals.platformFeesPaise),
      rupees(r.totals.cashFeesPaise),
      rupees(r.totals.refundedPaise),
      rupees(r.totals.netPaise),
    ],
  ]);
}

/** Revenue per day / week / month, in rupees. */
export function revenueByPeriodCsv(r: Revenue): string {
  return toCsv([
    [
      r.period.group === 'day' ? 'Date' : r.period.group === 'week' ? 'Week from' : 'Month',
      'Platform fees (₹)',
      'Cash fees (₹)',
      'MOM revenue (₹)',
    ],
    ...r.series.map((s) => [
      s.bucket,
      rupees(s.platformFeesPaise),
      rupees(s.cashFeesPaise),
      rupees(s.netPaise),
    ]),
  ]);
}

/** Starts a file download in the browser. */
export function downloadText(text: string, filename: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
