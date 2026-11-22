'use client';

import { formatINR } from '@mom/shared';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Stat } from '@/components/ui/stat';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useOverview, useReconciliationRuns, useRunReconciliation, type Overview } from '@/lib/admin-finance';
import { formatDateTime } from '@/lib/time';

const dayFmt = new Intl.DateTimeFormat('en-IN', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** Admin overview (spec §6.3 A1): today at a glance and what needs attention. */
export function OverviewView() {
  const overview = useOverview();
  if (overview.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-10 w-56" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }
  if (overview.isError) {
    return (
      <EmptyState
        as="h1"
        title="Can't load the overview"
        description="Check your internet connection, then try again."
        action={<Button onClick={() => overview.refetch()}>Try again</Button>}
      />
    );
  }
  const o = overview.data;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Overview</h1>
        <p className="text-ink-muted">Today, {dayFmt.format(new Date(`${o.day}T00:00:00Z`))}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Orders"
          value={o.today.orders}
          hint={`${o.today.collected} collected · ${o.today.upiOrders} UPI, ${o.today.cashOrders} cash`}
        />
        <Stat
          label="Order value"
          value={formatINR(o.today.orderValuePaise)}
          hint="What students are paying (not rejected or cancelled)"
        />
        <Stat
          label="MOM revenue"
          value={formatINR(o.today.revenuePaise)}
          hint="Fees earned today, after refunds"
        />
        <Stat
          label="Failed payments"
          value={o.today.failedPayments}
          hint={o.today.failedPayments > 0 ? 'UPI payments that did not go through' : 'None today'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="font-display text-xl font-bold">Live orders</h2>
          <dl className="tabular grid grid-cols-3 gap-2 text-center">
            {(
              [
                ['New', o.live.placed],
                ['Preparing', o.live.preparing],
                ['Ready', o.live.ready],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-(--radius-control) bg-surface-2 p-2">
                <dt className="text-sm text-ink-muted">{label}</dt>
                <dd className="font-display text-3xl font-bold">{value}</dd>
              </div>
            ))}
          </dl>
          <Link href="/admin/orders" className="text-sm font-semibold underline-offset-2 hover:underline">
            Open the orders explorer
          </Link>
        </Card>
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="font-display text-xl font-bold">Stalls</h2>
          <p>
            <span className="tabular font-display text-3xl font-bold">{o.stalls.openNow}</span> open now, of{' '}
            {plural(o.stalls.active, 'live stall')}
          </p>
          <p className="text-sm text-ink-muted">
            {plural(o.stalls.draft, 'draft')} waiting to go live
            {o.stalls.payoutsInReview > 0 && ` · ${o.stalls.payoutsInReview} UPI payout account(s) in review`}
          </p>
          <Link href="/admin/stalls" className="text-sm font-semibold underline-offset-2 hover:underline">
            Manage stalls
          </Link>
        </Card>
        <Attention o={o} />
      </div>

      <Reconciliation />
    </div>
  );
}

function Attention({ o }: { o: Overview }) {
  const r = o.reconciliation;
  return (
    <Card className="flex flex-col gap-2 p-4">
      <h2 className="font-display text-xl font-bold">Needs attention</h2>
      <ul className="flex flex-col gap-2">
        <li className="flex items-start gap-2">
          {o.attention.refundPending > 0 ? (
            <AlertTriangle size={18} aria-hidden className="mt-0.5 shrink-0 text-warning" />
          ) : (
            <CheckCircle2 size={18} aria-hidden className="mt-0.5 shrink-0 text-success" />
          )}
          <span>
            {o.attention.refundPending > 0
              ? `${plural(o.attention.refundPending, 'refund')} waiting to be retried (orders explorer → Payment status: Refund pending)`
              : 'No refunds waiting'}
          </span>
        </li>
        <li className="flex items-start gap-2">
          {r?.status === 'ok' ? (
            <CheckCircle2 size={18} aria-hidden className="mt-0.5 shrink-0 text-success" />
          ) : (
            <AlertTriangle size={18} aria-hidden className="mt-0.5 shrink-0 text-warning" />
          )}
          <span>
            {!r
              ? 'Money check has not run yet'
              : r.status === 'ok'
                ? `Money check OK (${formatDateTime(new Date(r.ranAt))})`
                : `Money check found ${plural(r.errors, 'problem')} (${formatDateTime(new Date(r.ranAt))})`}
          </span>
        </li>
      </ul>
    </Card>
  );
}

function Reconciliation() {
  const runs = useReconciliationRuns();
  const run = useRunReconciliation();
  const toast = useToast();
  const last = runs.data?.[0];
  return (
    <section aria-labelledby="recon-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="recon-title" className="font-display text-xl font-bold">
            Money check
          </h2>
          <p className="text-sm text-ink-muted">
            Every night at 2:30 AM, the ledger is checked against every order and its Razorpay payment from
            the last 7 days.
          </p>
        </div>
        <Button
          variant="secondary"
          loading={run.isPending}
          onClick={() =>
            run.mutate(7, {
              onSuccess: ({ run: r }) =>
                toast(
                  r.status === 'ok' ? `All ${r.ordersChecked} orders check out` : 'Problems found: see below',
                  r.status === 'ok' ? 'success' : 'error',
                ),
              onError: (err) =>
                toast(err instanceof ApiError ? err.message : 'Couldn’t run the check', 'error'),
            })
          }
        >
          Run now
        </Button>
      </div>
      {runs.isPending ? (
        <Skeleton className="h-24" />
      ) : !last ? (
        <p className="text-ink-muted">No checks yet.</p>
      ) : (
        <Card className="flex flex-col gap-2 p-4">
          <p className="font-semibold">
            {last.status === 'ok' ? 'Everything matches' : 'Mismatches found'} ·{' '}
            {plural(last.ordersChecked, 'order')} checked · {formatDateTime(new Date(last.ranAt))}
            {last.startedBy ? '' : ' (nightly)'}
          </p>
          {last.issues.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {last.issues.slice(0, 20).map((i, n) => (
                <li
                  key={`${i.orderId}-${i.kind}-${n}`}
                  className="flex flex-wrap items-start justify-between gap-2 py-2"
                >
                  <span className="flex items-start gap-2">
                    <AlertTriangle
                      size={16}
                      aria-hidden
                      className={
                        i.severity === 'error'
                          ? 'mt-0.5 shrink-0 text-danger'
                          : 'mt-0.5 shrink-0 text-warning'
                      }
                    />
                    <span>
                      <span className="font-semibold">{i.severity === 'error' ? 'Problem' : 'Check'}:</span>{' '}
                      {i.message}
                    </span>
                  </span>
                  <Link
                    href={`/admin/orders/${i.orderId}`}
                    className="text-sm font-semibold underline-offset-2 hover:underline"
                  >
                    Open order
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {last.issues.length > 20 && (
            <p className="text-sm text-ink-muted">and {last.issues.length - 20} more (see the API logs).</p>
          )}
        </Card>
      )}
    </section>
  );
}
