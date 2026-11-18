'use client';

import { formatBps, formatINR } from '@mom/shared';
import { MapPin, ReceiptText } from 'lucide-react';
import { useParams } from 'next/navigation';
import { ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { StatusChip } from '@/components/ui/status-chip';
import { TokenTicket } from '@/components/ui/token-ticket';
import { ApiError } from '@/lib/api-client';
import { STATUS_LABEL, useOrder } from '@/lib/orders';

/** The order and its token (QR code and live tracking arrive with #16 and #17). */
export function OrderView() {
  const { id } = useParams<{ id: string }>();
  const order = useOrder(id);

  if (order.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size={28} label="Loading your order" />
      </div>
    );
  }
  if (order.isError) {
    const notFound = order.error instanceof ApiError && order.error.status === 404;
    return (
      <EmptyState
        as="h1"
        icon={<ReceiptText size={36} aria-hidden />}
        title={notFound ? 'Order not found' : 'Couldn’t load the order'}
        description={notFound ? 'It may belong to another account.' : 'Check your connection and try again.'}
        action={<ButtonLink href="/">Go to stalls</ButtonLink>}
      />
    );
  }

  const o = order.data;
  return (
    <div className="flex flex-col items-center gap-5">
      <h1 className="sr-only">Your order at {o.stall.name}</h1>
      {o.tokenNo ? (
        <TokenTicket
          token={o.tokenNo}
          stallName={o.stall.name}
          pickupCode={o.pickupCode}
          status={STATUS_LABEL[o.status]}
        />
      ) : (
        <Card className="w-full p-5 text-center">
          <p className="font-display text-2xl font-bold">{STATUS_LABEL[o.status]}</p>
          <p className="text-ink-muted">Your token appears here once the payment is confirmed.</p>
        </Card>
      )}

      <div className="flex w-full flex-col gap-1 text-center">
        <StatusChip tone={o.status === 'ready' ? 'success' : 'haldi'}>{STATUS_LABEL[o.status]}</StatusChip>
        {o.stall.location && (
          <span className="inline-flex items-center justify-center gap-1 text-sm text-ink-muted">
            <MapPin size={14} aria-hidden /> {o.stall.location}
          </span>
        )}
        {o.paymentMethod === 'cash' && o.paymentStatus === 'due' && (
          <p className="font-semibold">Pay {formatINR(o.totalPaise)} in cash when you collect.</p>
        )}
      </div>

      <Card className="w-full p-4">
        <h2 className="mb-2 font-display text-xl font-bold">Order details</h2>
        <ul className="flex flex-col gap-1.5 text-sm">
          {o.items.map((i) => (
            <li key={i.itemId} className="flex justify-between gap-3">
              <span>
                {i.quantity} × {i.name}
              </span>
              <span className="tabular">{formatINR(i.lineTotalPaise)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-border pt-3 text-sm">
          <dt className="text-ink-muted">Item total</dt>
          <dd className="tabular text-right">{formatINR(o.subtotalPaise)}</dd>
          <dt className="text-ink-muted">Platform fee ({formatBps(o.platformFeeBps)})</dt>
          <dd className="tabular text-right">{formatINR(o.platformFeePaise)}</dd>
          {o.cashFeePaise > 0 && (
            <>
              <dt className="text-ink-muted">Cash handling fee ({formatBps(o.cashFeeBps)})</dt>
              <dd className="tabular text-right">{formatINR(o.cashFeePaise)}</dd>
            </>
          )}
          <dt className="font-bold">Total ({o.paymentMethod === 'cash' ? 'cash' : 'UPI'})</dt>
          <dd className="tabular text-right font-bold">{formatINR(o.totalPaise)}</dd>
        </dl>
        {o.note && <p className="mt-3 text-sm text-ink-muted">Note: “{o.note}”</p>}
      </Card>
      <ButtonLink href="/" variant="secondary">
        Back to stalls
      </ButtonLink>
    </div>
  );
}
