'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import { istDate } from './admin-finance';

export interface StallBalance {
  stallId: string;
  stallName: string;
  status: 'draft' | 'active' | 'suspended';
  routeStatus: string;
  owedPaise: number;
  heldPaise: number;
  heldTransfers: number;
  releasedLast7DaysPaise: number;
  transferProblems: number;
  lastSettlementAt: string | null;
}

export interface Statement {
  stall: { id: string; name: string };
  period: { from: string; to: string };
  openingPaise: number;
  lines: Array<{
    at: string;
    kind: 'cash_order_fees' | 'adjustment' | 'settlement';
    description: string;
    amountPaise: number;
    balancePaise: number;
    orderId: string | null;
  }>;
  closingPaise: number;
  totals: { feesPaise: number; adjustmentsPaise: number; settledPaise: number };
  upi: {
    transferredPaise: number;
    releasedPaise: number;
    reversedPaise: number;
    heldNowPaise: number;
    failedTransfers: number;
  };
  settlements: Array<{
    id: string;
    amountPaise: number;
    periodStart: string;
    periodEnd: string;
    note: string | null;
    createdAt: string;
  }>;
}

export type StatementPreset = 'last_week' | 'this_week' | 'this_month';

/** India-date ranges for the statement page (weeks run Monday–Sunday). */
export function statementPeriod(preset: StatementPreset, now: Date): { from: string; to: string } {
  const today = istDate(now);
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  if (preset === 'this_week') return { from: istDate(now, -weekday), to: today };
  if (preset === 'this_month') return { from: `${today.slice(0, 8)}01`, to: today };
  return { from: istDate(now, -weekday - 7), to: istDate(now, -weekday - 1) };
}

export function useSettlements() {
  return useQuery({
    queryKey: ['admin', 'settlements'],
    queryFn: () => apiRequest<{ stalls: StallBalance[] }>('/v1/admin/settlements'),
    select: (d) => d.stalls,
  });
}

export function useStatement(stallId: string, period: { from: string; to: string }) {
  return useQuery({
    queryKey: ['admin', 'statement', stallId, period.from, period.to],
    queryFn: () =>
      apiRequest<Statement>(
        `/v1/admin/stalls/${encodeURIComponent(stallId)}/statement?from=${period.from}&to=${period.to}`,
      ),
    placeholderData: (previous) => previous,
  });
}

export function useRecordSettlement(stallId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { amountPaise: number; periodStart: string; periodEnd: string; note?: string }) =>
      apiRequest<{ settlementId: string; amountPaise: number; owedPaise: number }>(
        `/v1/admin/stalls/${encodeURIComponent(stallId)}/settlements`,
        { method: 'POST', body: input },
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settlements'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'statement', stallId] });
    },
  });
}

export function useRetryTransfer(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<{ transfer: { status: string; lastError: string | null } }>(
        `/v1/admin/orders/${encodeURIComponent(orderId)}/transfer/retry`,
        { method: 'POST' },
      ),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'order', orderId] }),
  });
}

const rupees = (paise: number) => (paise / 100).toFixed(2);
const cell = (t: string) => (/[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);

/** The statement as CSV: opening line, each line with its running balance, closing line. */
export function statementCsv(s: Statement): string {
  const rows: string[][] = [
    ['Date', 'Description', 'Amount (₹)', 'Balance owed to MOM (₹)'],
    [s.period.from, 'Opening balance', '', rupees(s.openingPaise)],
    ...s.lines.map((l) => [l.at.slice(0, 10), l.description, rupees(l.amountPaise), rupees(l.balancePaise)]),
    [s.period.to, 'Closing balance', '', rupees(s.closingPaise)],
  ];
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
