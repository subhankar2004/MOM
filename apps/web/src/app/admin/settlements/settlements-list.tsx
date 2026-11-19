'use client';

import { formatINR } from '@mom/shared';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Stat } from '@/components/ui/stat';
import { StatusChip } from '@/components/ui/status-chip';
import { useSettlements, type StallBalance } from '@/lib/admin-settlements';
import { formatDateTime } from '@/lib/time';

/** Settlements (spec §6.3 A6): what each stall owes MOM, and its UPI money held / paid out. */
export function SettlementsList() {
  const balances = useSettlements();
  if (balances.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (balances.isError) {
    return (
      <EmptyState
        as="h1"
        title="Can't load settlements"
        description="Check your internet connection, then try again."
        action={<Button onClick={() => balances.refetch()}>Try again</Button>}
      />
    );
  }
  const rows = balances.data;
  const sum = (k: 'owedPaise' | 'heldPaise' | 'releasedLast7DaysPaise') => rows.reduce((t, r) => t + r[k], 0);
  const problems = rows.reduce((t, r) => t + r.transferProblems, 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-3xl font-bold">Settlements</h1>
        <p className="text-ink-muted">
          Cash orders: stalls keep the student&apos;s payment and owe MOM the fees. UPI orders: Razorpay pays
          each stall its food money, held until the student collects.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Cash fees owed to MOM" value={formatINR(sum('owedPaise'))} hint="by all stalls" />
        <Stat
          label="UPI held until pickup"
          value={formatINR(sum('heldPaise'))}
          hint="paid out when collected"
        />
        <Stat
          label="Paid out to stalls"
          value={formatINR(sum('releasedLast7DaysPaise'))}
          hint="last 7 days"
        />
        <Stat
          label="Payout problems"
          value={problems}
          hint={problems > 0 ? 'see the money check on Overview to retry' : 'none'}
        />
      </div>
      <DataTable<StallBalance>
        caption="Stall balances, most owed first"
        rows={rows}
        rowKey={(r) => r.stallId}
        empty="No stalls yet."
        columns={[
          {
            key: 'stall',
            header: 'Stall',
            cell: (r) => (
              <Link
                href={`/admin/settlements/${r.stallId}`}
                className="font-semibold text-brand underline-offset-2 hover:underline dark:text-ink"
              >
                {r.stallName}
              </Link>
            ),
          },
          {
            key: 'owed',
            header: 'Owes MOM',
            align: 'right',
            cell: (r) => <span className="tabular font-semibold">{formatINR(r.owedPaise)}</span>,
          },
          {
            key: 'held',
            header: 'UPI held',
            align: 'right',
            cell: (r) => (
              <span className="tabular">
                {formatINR(r.heldPaise)}
                {r.heldTransfers > 0 && (
                  <span className="block text-xs text-ink-muted">{r.heldTransfers} orders</span>
                )}
              </span>
            ),
          },
          {
            key: 'released',
            header: 'Paid out (7 days)',
            align: 'right',
            cell: (r) => <span className="tabular">{formatINR(r.releasedLast7DaysPaise)}</span>,
          },
          {
            key: 'problems',
            header: 'Payouts',
            cell: (r) =>
              r.transferProblems > 0 ? (
                <StatusChip tone="danger">{r.transferProblems} failed</StatusChip>
              ) : r.routeStatus === 'activated' ? (
                <StatusChip tone="success">OK</StatusChip>
              ) : (
                <StatusChip>Cash only</StatusChip>
              ),
          },
          {
            key: 'last',
            header: 'Last cash settlement',
            cell: (r) => (
              <span className="text-ink-muted">
                {r.lastSettlementAt ? formatDateTime(new Date(r.lastSettlementAt)) : 'Never'}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
