'use client';

import { formatINR } from '@mom/shared';
import { Download, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Stat } from '@/components/ui/stat';
import { Tabs } from '@/components/ui/tabs';
import { SalesChart } from '@/components/vendor/sales-chart';
import { useNow } from '@/lib/use-now';
import {
  periodFor,
  reportCsv,
  useStallReport,
  type ReportView,
  type StallReport,
} from '@/lib/vendor-reports';
import { useCurrentStall } from '@/lib/vendor-stall';

const VIEWS: Array<{ key: ReportView; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Last 7 days' },
  { key: 'month', label: 'This month' },
];

const rangeFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fullFmt = new Intl.DateTimeFormat('en-IN', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** Sales & dues (spec §6.2 V8). Owners only: counter staff see a note instead. */
export function SalesView() {
  const { current: stall } = useCurrentStall();
  if (stall.memberRole === 'staff') {
    return (
      <EmptyState
        as="h1"
        icon={<Wallet size={36} aria-hidden />}
        title="Sales"
        description="Only the stall owner can see sales and money owed."
      />
    );
  }
  return <Sales stallId={stall.id} stallName={stall.name} />;
}

function Sales({ stallId, stallName }: { stallId: string; stallName: string }) {
  const [view, setView] = useState<ReportView>('today');
  const now = useNow(60_000);
  const period = periodFor(view, now);
  const report = useStallReport(stallId, period);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl font-bold">Sales</h1>
      <Tabs items={VIEWS} value={view} onChange={setView} label="Period">
        <div className="flex flex-col gap-4 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-ink-muted">
              {period.from === period.to
                ? fullFmt.format(asDate(period.from))
                : `${rangeFmt.format(asDate(period.from))} – ${rangeFmt.format(asDate(period.to))}`}
            </p>
            {report.data && (
              <Button
                variant="secondary"
                size="sm"
                icon={<Download size={16} aria-hidden />}
                onClick={() => download(report.data, stallName)}
              >
                Download CSV
              </Button>
            )}
          </div>
          {report.isPending ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
          ) : report.isError ? (
            <EmptyState
              title="Can't load your sales"
              description="Check your internet connection, then try again."
              action={<Button onClick={() => report.refetch()}>Try again</Button>}
            />
          ) : (
            <Report r={report.data} view={view} />
          )}
        </div>
      </Tabs>
    </div>
  );
}

function Report({ r, view }: { r: StallReport; view: ReportView }) {
  const hasSales = r.orders.collected > 0;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Sales"
          value={formatINR(r.sales.grossPaise)}
          hint={`${plural(r.orders.collected, 'order')} handed over`}
        />
        <Stat label="UPI" value={formatINR(r.sales.upiPaise)} hint={plural(r.orders.upi, 'order')} />
        <Stat
          label="Cash"
          value={formatINR(r.sales.cashPaise)}
          hint={`${plural(r.orders.cash, 'order')} · ${formatINR(r.sales.cashTakenPaise)} taken incl. fees`}
        />
        <Stat
          label="MOM fees"
          value={formatINR(r.fees.netPaise)}
          hint={
            r.fees.refundedPaise > 0
              ? `after ${formatINR(r.fees.refundedPaise)} refunded`
              : 'paid by students'
          }
        />
      </div>

      {(r.orders.rejected > 0 || r.orders.cancelled > 0) && (
        <p className="text-sm text-ink-muted">
          Not counted: {plural(r.orders.rejected, 'rejected order')},{' '}
          {plural(r.orders.cancelled, 'cancelled order')}.
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="font-display text-xl font-bold">Cash fees owed to MOM</h2>
          <p className="tabular font-display text-3xl font-bold">{formatINR(r.dues.outstandingPaise)}</p>
          <p className="text-sm text-ink-muted">
            You keep the student&apos;s full cash payment, so MOM&apos;s fees on cash orders are owed back.
          </p>
          <dl className="tabular mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-muted">Owed for this period</dt>
            <dd className="text-right">{formatINR(r.dues.owedPaise)}</dd>
            <dt className="text-ink-muted">Paid to MOM this period</dt>
            <dd className="text-right">{formatINR(r.dues.settledPaise)}</dd>
          </dl>
        </Card>
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="font-display text-xl font-bold">UPI payouts</h2>
          <p className="tabular font-display text-3xl font-bold">{formatINR(r.payouts.upiDuePaise)}</p>
          <p className="text-sm text-ink-muted">
            Your UPI sales for this period. Razorpay pays them to your bank; MOM&apos;s fee was added to the
            student&apos;s bill, so you get the full amount.
          </p>
          <p className="text-sm text-ink-muted">
            {r.payouts.transfersReceivedPaise === null
              ? 'Payout details will appear here once payouts are switched on for your stall.'
              : `Received so far: ${formatINR(r.payouts.transfersReceivedPaise)}`}
          </p>
        </Card>
      </div>

      {view !== 'today' && (
        <Card className="p-4">
          {hasSales ? (
            <SalesChart daily={r.daily} />
          ) : (
            <p className="py-8 text-center text-ink-muted">No orders handed over in this period yet.</p>
          )}
        </Card>
      )}
    </>
  );
}

function download(r: StallReport, stallName: string) {
  const blob = new Blob([reportCsv(r)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe =
    stallName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'stall';
  a.href = url;
  a.download = `mom-sales-${safe}-${r.period.from}-to-${r.period.to}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
