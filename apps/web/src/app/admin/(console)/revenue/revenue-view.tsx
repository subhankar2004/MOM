'use client';

import { formatINR } from '@mom/shared';
import { Download } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { StackedBars } from '@/components/charts/stacked-bars';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Stat } from '@/components/ui/stat';
import { Tabs } from '@/components/ui/tabs';
import {
  downloadText,
  presetPeriod,
  revenueByPeriodCsv,
  revenueByStallCsv,
  useRevenue,
  type Preset,
  type Revenue,
} from '@/lib/admin-finance';
import { useNow } from '@/lib/use-now';

const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: '30d', label: 'Last 30 days' },
  { key: '12w', label: 'Last 12 weeks' },
  { key: '12m', label: 'Last 12 months' },
];

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const short = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** MOM's revenue (spec §6.3 A2), built from the ledger: by period, per stall, UPI/cash mix. */
export function RevenueView() {
  const [preset, setPreset] = useState<Preset>('30d');
  const now = useNow(60_000);
  const period = presetPeriod(preset, now);
  const revenue = useRevenue(period);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl font-bold">Revenue</h1>
      <Tabs items={PRESETS} value={preset} onChange={setPreset} label="Period">
        <div className="flex flex-col gap-4 pt-4">
          {revenue.isPending ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
          ) : revenue.isError ? (
            <EmptyState
              title="Can't load revenue"
              description="Check your internet connection, then try again."
              action={<Button onClick={() => revenue.refetch()}>Try again</Button>}
            />
          ) : (
            <Report r={revenue.data} />
          )}
        </div>
      </Tabs>
    </div>
  );
}

function bucketLabels(r: Revenue, bucket: string, i: number) {
  const d = asDate(bucket);
  // Thin bars on phones: label every other month and every third week (labels may spill
  // past their bar, so they need room).
  if (r.period.group === 'month')
    return { tick: i % 2 === 0 ? monthFmt.format(d).split(' ')[0]! : '', name: monthFmt.format(d) };
  if (r.period.group === 'week')
    return { tick: i % 3 === 0 ? short.format(d) : '', name: `Week of ${short.format(d)}` };
  const every = Math.ceil(r.series.length / 6);
  return { tick: i % every === 0 ? short.format(d).split(' ')[0]! : '', name: short.format(d) };
}

function Report({ r }: { r: Revenue }) {
  const t = r.totals;
  const mixOrders = r.mix.upi.orders + r.mix.cash.orders;
  const share = (n: number) => (mixOrders ? `${Math.round((n / mixOrders) * 100)}%` : '—');
  const file = `${r.period.from}-to-${r.period.to}`;
  return (
    <>
      <p className="text-ink-muted">
        {short.format(asDate(r.period.from))} – {short.format(asDate(r.period.to))}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="MOM revenue"
          value={formatINR(t.netPaise)}
          hint={
            t.adjustmentsPaise !== 0 ? `incl. ${formatINR(t.adjustmentsPaise)} adjustments` : 'after refunds'
          }
        />
        <Stat label="Platform fees" value={formatINR(t.platformFeesPaise)} hint="1% on every order" />
        <Stat label="Cash fees" value={formatINR(t.cashFeesPaise)} hint="on cash orders, owed by stalls" />
        <Stat label="Refunded" value={formatINR(t.refundedPaise)} hint="fees given back on refunds" />
      </div>

      <Card className="p-4">
        {r.series.every((x) => x.platformFeesPaise === 0 && x.cashFeesPaise === 0) ? (
          <p className="py-8 text-center text-ink-muted">No fees in this period yet.</p>
        ) : (
          <StackedBars
            title="Fees per period"
            listLabel="MOM fees per period"
            series={[
              { key: 'platform', label: 'Platform fees', className: 'bg-chart-upi' },
              { key: 'cash', label: 'Cash fees', className: 'bg-chart-cash' },
            ]}
            rows={r.series.map((s, i) => ({
              id: s.bucket,
              ...bucketLabels(r, s.bucket, i),
              values: { platform: s.platformFeesPaise, cash: s.cashFeesPaise },
              note:
                s.netPaise !== s.platformFeesPaise + s.cashFeesPaise
                  ? `net ${formatINR(s.netPaise)}`
                  : undefined,
            }))}
            footer={
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                icon={<Download size={16} aria-hidden />}
                onClick={() =>
                  downloadText(revenueByPeriodCsv(r), `mom-revenue-by-${r.period.group}-${file}.csv`)
                }
              >
                Download CSV
              </Button>
            }
          />
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Stat
          label="UPI orders collected"
          value={`${r.mix.upi.orders} (${share(r.mix.upi.orders)})`}
          hint={`${formatINR(r.mix.upi.valuePaise)} paid by students`}
        />
        <Stat
          label="Cash orders collected"
          value={`${r.mix.cash.orders} (${share(r.mix.cash.orders)})`}
          hint={`${formatINR(r.mix.cash.valuePaise)} paid at counters`}
        />
      </div>

      <section aria-labelledby="by-stall" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="by-stall" className="font-display text-xl font-bold">
            Commission per stall
          </h2>
          <Button
            variant="secondary"
            size="sm"
            icon={<Download size={16} aria-hidden />}
            onClick={() => downloadText(revenueByStallCsv(r), `mom-revenue-by-stall-${file}.csv`)}
          >
            Download CSV
          </Button>
        </div>
        <DataTable
          caption="Commission per stall, highest first"
          rows={r.byStall}
          rowKey={(s) => s.stallId}
          empty="No fees in this period yet."
          columns={[
            {
              key: 'stall',
              header: 'Stall',
              cell: (s) => (
                <Link
                  href={`/admin/stalls/${s.stallId}`}
                  className="font-semibold underline-offset-2 hover:underline"
                >
                  {s.stallName}
                </Link>
              ),
            },
            {
              key: 'orders',
              header: 'Orders',
              align: 'right',
              cell: (s) => <span className="tabular">{s.orders}</span>,
            },
            {
              key: 'value',
              header: 'Order value',
              align: 'right',
              cell: (s) => <span className="tabular">{formatINR(s.orderValuePaise)}</span>,
            },
            {
              key: 'platform',
              header: 'Platform fees',
              align: 'right',
              cell: (s) => <span className="tabular">{formatINR(s.platformFeesPaise)}</span>,
            },
            {
              key: 'cash',
              header: 'Cash fees',
              align: 'right',
              cell: (s) => <span className="tabular">{formatINR(s.cashFeesPaise)}</span>,
            },
            {
              key: 'net',
              header: 'MOM revenue',
              align: 'right',
              cell: (s) => <span className="tabular font-semibold">{formatINR(s.netPaise)}</span>,
            },
          ]}
        />
      </section>
    </>
  );
}
