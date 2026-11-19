'use client';

import { formatINR, paise } from '@mom/shared';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs } from '@/components/ui/tabs';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { downloadText } from '@/lib/admin-finance';
import {
  statementCsv,
  statementPeriod,
  useRecordSettlement,
  useStatement,
  type Statement,
  type StatementPreset,
} from '@/lib/admin-settlements';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/time';
import { useNow } from '@/lib/use-now';

const PRESETS: Array<{ key: StatementPreset; label: string }> = [
  { key: 'last_week', label: 'Last week' },
  { key: 'this_week', label: 'This week' },
  { key: 'this_month', label: 'This month' },
];
const dayFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const asDate = (d: string) => dayFmt.format(new Date(`${d}T00:00:00Z`));

/** A stall's statement (spec §6.3 A6): print or download, record cash it paid MOM. */
export function StatementView() {
  const { stallId } = useParams<{ stallId: string }>();
  const [preset, setPreset] = useState<StatementPreset>('last_week');
  const now = useNow(60_000);
  const period = statementPeriod(preset, now);
  const statement = useStatement(stallId, period);
  const [recording, setRecording] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/admin/settlements"
        className="flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-ink-muted hover:text-ink print:hidden"
      >
        <ArrowLeft size={16} aria-hidden /> All stalls
      </Link>
      {statement.isPending ? (
        <Skeleton className="h-64" />
      ) : statement.isError ? (
        <EmptyState
          as="h1"
          title={
            statement.error instanceof ApiError && statement.error.status === 404
              ? 'Stall not found'
              : "Can't load the statement"
          }
          description="Check the link and your internet connection, then try again."
          action={<Button onClick={() => statement.refetch()}>Try again</Button>}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-display text-3xl font-bold">{statement.data.stall.name}</h1>
              <p className="text-ink-muted">
                Statement, {asDate(statement.data.period.from)} – {asDate(statement.data.period.to)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 print:hidden">
              <Button
                variant="secondary"
                size="sm"
                icon={<Download size={16} aria-hidden />}
                onClick={() =>
                  downloadText(
                    statementCsv(statement.data),
                    `mom-statement-${statement.data.stall.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${period.from}-to-${period.to}.csv`,
                  )
                }
              >
                Download CSV
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Printer size={16} aria-hidden />}
                onClick={() => window.print()}
              >
                Print / save PDF
              </Button>
              <Button size="sm" onClick={() => setRecording(true)}>
                Record cash received
              </Button>
            </div>
          </div>
          <div className="print:hidden">
            <Tabs items={PRESETS} value={preset} onChange={setPreset} label="Period">
              <span />
            </Tabs>
          </div>
          <StatementBody s={statement.data} />
          <RecordSheet
            open={recording}
            onClose={() => setRecording(false)}
            stallId={stallId}
            owedNowPaise={statement.data.closingPaise}
            period={period}
          />
        </>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div
      className={cn('flex justify-between gap-3', strong && 'border-t border-border pt-2 text-lg font-bold')}
    >
      <dt>{label}</dt>
      <dd className="tabular">{formatINR(value)}</dd>
    </div>
  );
}

function StatementBody({ s }: { s: Statement }) {
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="font-display text-xl font-bold">Cash fees owed to MOM</h2>
          <dl className="flex flex-col gap-1">
            <Row label="Opening balance" value={s.openingPaise} />
            <Row label="+ Fees on cash orders" value={s.totals.feesPaise} />
            {s.totals.adjustmentsPaise !== 0 && (
              <Row label="± Adjustments" value={s.totals.adjustmentsPaise} />
            )}
            <Row label="− Cash paid to MOM" value={s.totals.settledPaise} />
            <Row label="Closing balance" value={s.closingPaise} strong />
          </dl>
        </Card>
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="font-display text-xl font-bold">UPI payouts (Razorpay)</h2>
          <dl className="flex flex-col gap-1">
            <Row label="Sent to the stall's account" value={s.upi.transferredPaise} />
            <Row label="Paid out (orders collected)" value={s.upi.releasedPaise} />
            <Row label="Taken back (refunds)" value={s.upi.reversedPaise} />
            <Row label="Held right now until pickup" value={s.upi.heldNowPaise} />
          </dl>
          {s.upi.failedTransfers > 0 && (
            <p className="text-sm font-semibold text-danger">
              {s.upi.failedTransfers} payout(s) failed: open the order from the money check on the overview to
              retry.
            </p>
          )}
        </Card>
      </div>

      <section aria-labelledby="lines" className="flex flex-col gap-2">
        <h2 id="lines" className="font-display text-xl font-bold">
          Lines
        </h2>
        <div className="overflow-x-auto rounded-(--radius-card) border border-border bg-surface">
          <table className="w-full text-sm">
            <caption className="sr-only">Statement lines with running balance</caption>
            <thead className="bg-surface-2 text-left text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  When
                </th>
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  What
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                  Amount
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody className="tabular">
              <tr className="border-t border-border">
                <td className="px-4 py-2" colSpan={3}>
                  Opening balance
                </td>
                <td className="px-4 py-2 text-right">{formatINR(s.openingPaise)}</td>
              </tr>
              {s.lines.map((l, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-4 py-2 whitespace-nowrap">{formatDateTime(new Date(l.at))}</td>
                  <td className="px-4 py-2">
                    {l.orderId ? (
                      <Link
                        href={`/admin/orders/${l.orderId}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {l.description}
                      </Link>
                    ) : (
                      l.description
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">{formatINR(l.amountPaise)}</td>
                  <td className="px-4 py-2 text-right">{formatINR(l.balancePaise)}</td>
                </tr>
              ))}
              <tr className="border-t border-border font-bold">
                <td className="px-4 py-2" colSpan={3}>
                  Closing balance
                </td>
                <td className="px-4 py-2 text-right">{formatINR(s.closingPaise)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function RecordSheet({
  open,
  onClose,
  stallId,
  owedNowPaise,
  period,
}: {
  open: boolean;
  onClose: () => void;
  stallId: string;
  owedNowPaise: number;
  period: { from: string; to: string };
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Record cash received">
      {open && <RecordForm stallId={stallId} owedNowPaise={owedNowPaise} period={period} onDone={onClose} />}
    </Sheet>
  );
}

function RecordForm({
  stallId,
  owedNowPaise,
  period,
  onDone,
}: {
  stallId: string;
  owedNowPaise: number;
  period: { from: string; to: string };
  onDone: () => void;
}) {
  const record = useRecordSettlement(stallId);
  const toast = useToast();
  const [amount, setAmount] = useState(owedNowPaise > 0 ? (owedNowPaise / 100).toFixed(2) : '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setError(undefined);
        let amountPaise: number;
        try {
          amountPaise = paise(amount.trim());
        } catch {
          setError('Enter the amount in rupees, like 72 or 72.40');
          return;
        }
        record.mutate(
          { amountPaise, periodStart: period.from, periodEnd: period.to, note: note.trim() || undefined },
          {
            onSuccess: (r) => {
              toast(`${formatINR(amountPaise)} recorded. Still owed: ${formatINR(r.owedPaise)}`, 'success');
              onDone();
            },
            onError: (err) =>
              setError(err instanceof ApiError ? err.message : 'That didn’t save. Try again.'),
          },
        );
      }}
    >
      <p>
        The stall paid MOM its cash fees. It owes {formatINR(owedNowPaise)} at the end of this statement; you
        can record part of it.
      </p>
      <TextField
        label="Amount received"
        leading="₹"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={error}
      />
      <TextField
        label="Note (optional)"
        hint="e.g. Cash collected at the stall"
        value={note}
        maxLength={200}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button type="submit" size="lg" fullWidth loading={record.isPending}>
        Record payment
      </Button>
    </form>
  );
}
