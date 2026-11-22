'use client';

import { formatINR } from '@mom/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { OrderStatusChip, PaymentStatusChip } from '@/components/order/order-status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useAdminOrder, useOrderAction, type AdminOrderDetail } from '@/lib/admin-console';
import { useRetryTransfer } from '@/lib/admin-settlements';
import { formatDateTime } from '@/lib/time';

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : 'That didn’t go through. Check your connection and try again.';

/** One order: bill, people, payments, timeline; cancel or refund with a reason (spec A5). */
export function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const query = useAdminOrder(id);
  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <EmptyState
        as="h1"
        title={missing ? 'Order not found' : "Can't load this order"}
        description={
          missing ? 'Check the link and try again.' : 'Check your internet connection, then try again.'
        }
        action={
          missing ? (
            <Link href="/admin/orders" className="font-semibold underline">
              All orders
            </Link>
          ) : (
            <Button onClick={() => query.refetch()}>Try again</Button>
          )
        }
      />
    );
  }
  return <Detail data={query.data} />;
}

function Detail({ data }: { data: AdminOrderDetail }) {
  const { order, stall, student } = data;
  const [sheet, setSheet] = useState<'cancel' | 'refund' | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/admin/orders"
        className="flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden /> All orders
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-3xl font-bold">
            {order.tokenNo ? `Token #${order.tokenNo}` : 'Order'} · {stall.name}
          </h1>
          <OrderStatusChip status={order.status} />
          <PaymentStatusChip status={order.paymentStatus} />
        </div>
        <div className="flex gap-2">
          {data.can.refund && (
            <Button variant="secondary" onClick={() => setSheet('refund')}>
              {order.paymentStatus === 'refund_pending' ? 'Retry refund…' : 'Refund…'}
            </Button>
          )}
          {data.can.cancel && (
            <Button variant="danger" onClick={() => setSheet('cancel')}>
              Cancel order…
            </Button>
          )}
        </div>
      </div>
      {order.reason && (
        <p className="rounded-(--radius-control) bg-surface-2 px-3 py-2">
          Reason given: <span className="font-semibold">“{order.reason}”</span>
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="font-display text-xl font-bold">Bill</h2>
          <ul className="flex flex-col gap-1">
            {data.items.map((i) => (
              <li key={i.name} className="tabular flex justify-between gap-2">
                <span>
                  {i.quantity} × {i.name}
                </span>
                <span>{formatINR(i.lineTotalPaise)}</span>
              </li>
            ))}
          </ul>
          <dl className="tabular flex flex-col gap-1 border-t border-border pt-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Subtotal (stall)</dt>
              <dd>{formatINR(order.subtotalPaise)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">Platform fee</dt>
              <dd>{formatINR(order.platformFeePaise)}</dd>
            </div>
            {order.cashFeePaise > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-muted">Cash fee</dt>
                <dd>{formatINR(order.cashFeePaise)}</dd>
              </div>
            )}
            <div className="flex justify-between text-base font-bold">
              <dt>Total ({order.paymentMethod === 'upi' ? 'UPI' : 'cash'})</dt>
              <dd>{formatINR(order.totalPaise)}</dd>
            </div>
          </dl>
          {order.note && <p className="text-sm">Student&apos;s note: “{order.note}”</p>}
          <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
            <div>
              <dt className="text-ink-muted">Student</dt>
              <dd>
                <Link
                  href={`/admin/users/${student.id}`}
                  className="font-semibold underline-offset-2 hover:underline"
                >
                  {student.name ?? 'No name'}
                </Link>
                <span className="tabular block text-ink-muted">{student.phone}</span>
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Stall</dt>
              <dd>
                <Link
                  href={`/admin/stalls/${stall.id}`}
                  className="font-semibold underline-offset-2 hover:underline"
                >
                  {stall.name}
                </Link>
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-ink-muted">Order id</dt>
              <dd className="tabular text-xs break-all">{order.id}</dd>
            </div>
          </dl>
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <h2 className="font-display text-xl font-bold">Timeline</h2>
          <ol className="flex flex-col gap-3 border-l-2 border-border pl-4">
            {data.timeline.map((e, i) => (
              <li key={i} className="relative">
                <span
                  aria-hidden
                  className="absolute top-1.5 -left-[1.3rem] size-2.5 rounded-full bg-ink-muted"
                />
                <p className="font-semibold">{e.label}</p>
                <p className="text-sm text-ink-muted">
                  {formatDateTime(new Date(e.at))}
                  {e.by && ` · ${e.by}`}
                </p>
              </li>
            ))}
          </ol>
          {data.payout && <Payout orderId={order.id} payout={data.payout} />}
          {(data.payments.length > 0 || data.refunds.length > 0) && (
            <div className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
              <h3 className="font-semibold">Razorpay</h3>
              {data.payments.map((p) => (
                <p key={p.id} className="tabular">
                  Payment {p.providerPaymentId ?? '(not completed)'} · {formatINR(p.amountPaise)} · {p.status}
                </p>
              ))}
              {data.refunds.map((r) => (
                <p key={r.id} className="tabular">
                  Refund {formatINR(r.amountPaise)} · {r.status} · “{r.reason}”
                </p>
              ))}
            </div>
          )}
        </Card>
      </div>

      <ReasonSheet orderId={order.id} kind={sheet} onClose={() => setSheet(null)} detail={data} />
    </div>
  );
}

function ReasonSheet({
  orderId,
  kind,
  onClose,
  detail,
}: {
  orderId: string;
  kind: 'cancel' | 'refund' | null;
  onClose: () => void;
  detail: AdminOrderDetail;
}) {
  const cancel = useOrderAction(orderId, 'cancel');
  const refund = useOrderAction(orderId, 'refund');
  const action = kind === 'refund' ? refund : cancel;
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const paidUpi = detail.order.paymentStatus === 'paid' || detail.order.paymentStatus === 'refund_pending';

  return (
    <Sheet
      open={kind !== null}
      onClose={onClose}
      title={kind === 'refund' ? 'Refund this order?' : 'Cancel this order?'}
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(undefined);
          action.mutate(reason.trim(), {
            onSuccess: (d) => {
              toast(
                kind === 'refund'
                  ? 'Refund sent to Razorpay'
                  : d.refund === 'retry_later'
                    ? 'Order cancelled. The refund couldn’t start: retry it from here.'
                    : d.refund === 'started'
                      ? 'Order cancelled and refunded'
                      : 'Order cancelled',
                d.refund === 'retry_later' ? 'error' : 'success',
              );
              setReason('');
              onClose();
            },
            onError: (err) => setError(errorText(err)),
          });
        }}
      >
        <p>
          {kind === 'refund'
            ? `${formatINR(detail.order.totalPaise)} goes back to the student's UPI account. The order itself doesn't change.`
            : paidUpi
              ? `The student and the stall see it cancelled, and ${formatINR(detail.order.totalPaise)} is refunded to the student.`
              : 'The student and the stall see it cancelled.'}
        </p>
        <TextField
          label="Reason (recorded, and shown to the student)"
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
          error={error}
          autoComplete="off"
        />
        <Button
          type="submit"
          variant="danger"
          size="lg"
          fullWidth
          disabled={reason.trim().length < 3}
          loading={action.isPending}
        >
          {kind === 'refund' ? 'Refund' : 'Cancel order'}
        </Button>
      </form>
    </Sheet>
  );
}

const PAYOUT: Record<NonNullable<AdminOrderDetail['payout']>['status'], string> = {
  created: 'Not sent to Razorpay yet',
  on_hold: 'Held until the student collects',
  released: 'Paid out to the stall',
  reversed: 'Taken back (refunded)',
  failed: 'Failed',
};

/** The stall's share of a UPI order, paid through Razorpay Route (spec §4.2). */
function Payout({ orderId, payout }: { orderId: string; payout: NonNullable<AdminOrderDetail['payout']> }) {
  const retry = useRetryTransfer(orderId);
  const toast = useToast();
  const stuck = payout.status === 'failed' || (payout.status === 'created' && payout.lastError);
  return (
    <div className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
      <h3 className="font-semibold">Stall payout</h3>
      <p className="tabular">
        {formatINR(payout.amountPaise)} · {PAYOUT[payout.status]}
        {payout.providerTransferId && ` · ${payout.providerTransferId}`}
      </p>
      {payout.lastError && <p className="text-danger">Last error: {payout.lastError}</p>}
      {stuck && (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          loading={retry.isPending}
          onClick={() =>
            retry.mutate(undefined, {
              onSuccess: (r) =>
                toast(
                  `Payout: ${PAYOUT[r.transfer.status as keyof typeof PAYOUT] ?? r.transfer.status}`,
                  r.transfer.lastError ? 'error' : 'success',
                ),
              onError: (err) => toast(errorText(err), 'error'),
            })
          }
        >
          Retry payout
        </Button>
      )}
    </div>
  );
}
