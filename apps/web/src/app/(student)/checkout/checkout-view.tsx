'use client';

import { formatBps, formatINR, type FeeBreakdown } from '@mom/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Banknote, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiRequest } from '@/lib/api-client';
import { cartStore, useCart } from '@/lib/cart';
import { cn } from '@/lib/cn';
import { newIdempotencyKey, type Order } from '@/lib/orders';
import { useCartQuote } from '@/lib/quote';

type Method = 'upi' | 'cash';

function MethodOption({
  method,
  selected,
  onSelect,
  fees,
  disabledReason,
}: {
  method: Method;
  selected: boolean;
  onSelect: () => void;
  fees: FeeBreakdown | null;
  disabledReason?: string;
}) {
  const disabled = !fees || Boolean(disabledReason);
  const Icon = method === 'upi' ? Smartphone : Banknote;
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-(--radius-card) border-2 p-4 transition-colors',
        selected ? 'border-brand bg-surface' : 'border-border bg-surface',
        disabled && 'cursor-not-allowed bg-surface-2',
      )}
    >
      <input
        type="radio"
        name="payment"
        value={method}
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
        className="size-5 accent-(--brand)"
      />
      <Icon size={22} aria-hidden className="shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">
          {method === 'upi' ? 'Pay now by UPI' : 'Pay cash at the counter'}
        </span>
        <span className="text-sm text-ink-muted">
          {disabledReason ??
            (fees
              ? method === 'upi'
                ? 'Only the platform fee is added'
                : 'Adds a cash handling fee'
              : 'Not accepted by this stall')}
        </span>
      </span>
      {fees && !disabledReason && (
        <span className="tabular font-display text-xl font-bold">{formatINR(fees.totalPaise)}</span>
      )}
    </label>
  );
}

/** Checkout (spec §6.1 S5): choose UPI or cash, see the exact bill, place the order. */
export function CheckoutView() {
  const cart = useCart();
  const quote = useCartQuote(cart);
  const queryClient = useQueryClient();
  const router = useRouter();
  const [chosen, setChosen] = useState<Method | null>(null);
  const [key] = useState(newIdempotencyKey);

  const q = quote.data;
  const upiFees = q?.options.upi ?? null;
  const cashFees = q?.options.cash ?? null;
  const method: Method | null = chosen ?? (upiFees ? 'upi' : cashFees ? 'cash' : null);
  const fees = method === 'upi' ? upiFees : method === 'cash' ? cashFees : null;

  const place = useMutation({
    mutationFn: () =>
      apiRequest<{ order: Order }>('/v1/orders', {
        method: 'POST',
        idempotencyKey: key,
        body: {
          stallId: cart.stall!.id,
          items: cart.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
          paymentMethod: method,
          note: cart.note || undefined,
          expectedTotalPaise: fees!.totalPaise,
        },
      }),
    onSuccess: ({ order }) => {
      cartStore.clear();
      queryClient.setQueryData(['order', order.id], { order });
      // UPI: straight on to paying; cash: the token is already there.
      router.replace(order.paymentMethod === 'upi' ? `/orders/${order.id}?pay=1` : `/orders/${order.id}`);
    },
    onError: (err) => {
      // Prices or availability changed under us: show the fresh bill.
      if (err instanceof ApiError && err.code === 'CART_CHANGED') void quote.refetch();
    },
  });

  if (!cart.stall || cart.lines.length === 0) {
    if (place.isSuccess) return null; // navigating to the order
    return (
      <EmptyState
        as="h1"
        title="Nothing to check out"
        description="Your cart is empty."
        action={<ButtonLink href="/">Browse stalls</ButtonLink>}
      />
    );
  }

  const blocked = q && !q.canCheckout;
  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/cart"
        className="inline-flex items-center gap-1 self-start text-sm font-semibold text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden /> Back to cart
      </Link>
      <h1 className="font-display text-3xl font-black">Checkout</h1>
      <p className="text-ink-muted">
        {cart.lines.reduce((n, l) => n + l.quantity, 0)} items from{' '}
        <span className="font-semibold text-ink">{cart.stall.name}</span>
      </p>

      {quote.isPending && <Skeleton className="h-40 w-full" />}

      {q && (
        <>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 font-display text-2xl font-bold">How will you pay?</legend>
            <MethodOption
              method="upi"
              selected={method === 'upi'}
              onSelect={() => setChosen('upi')}
              fees={q.options.upi}
            />
            <MethodOption
              method="cash"
              selected={method === 'cash'}
              onSelect={() => setChosen('cash')}
              fees={cashFees}
            />
          </fieldset>

          {fees && (
            <Card className="p-4">
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-ink-muted">Item total</dt>
                <dd className="tabular text-right">{formatINR(fees.subtotalPaise)}</dd>
                <dt className="text-ink-muted">Platform fee ({formatBps(q.rates.platformFeeBps)})</dt>
                <dd className="tabular text-right">{formatINR(fees.platformFeePaise)}</dd>
                {fees.cashFeePaise > 0 && (
                  <>
                    <dt className="text-ink-muted">Cash handling fee ({formatBps(q.rates.cashFeeBps)})</dt>
                    <dd className="tabular text-right">{formatINR(fees.cashFeePaise)}</dd>
                  </>
                )}
                <dt className="pt-1 font-bold">Total</dt>
                <dd className="tabular pt-1 text-right font-display text-2xl font-bold">
                  {formatINR(fees.totalPaise)}
                </dd>
              </dl>
              {method === 'cash' && (
                <p className="mt-3 border-t border-border pt-3 text-sm text-ink-muted">
                  You’ll get your token now. Pay {formatINR(fees.totalPaise)} in cash when you collect your
                  food.
                </p>
              )}
            </Card>
          )}
          {cart.note && (
            <p className="text-sm">
              <span className="text-ink-muted">Note for the stall:</span> “{cart.note}”
            </p>
          )}
        </>
      )}

      {blocked && (
        <p role="status" className="rounded-(--radius-control) bg-warning-soft px-4 py-3 text-sm">
          Something in your cart needs attention.{' '}
          <Link href="/cart" className="font-semibold underline">
            Review your cart
          </Link>
        </p>
      )}
      {place.isError && (
        <p
          role="alert"
          className="rounded-(--radius-control) bg-danger-soft px-4 py-3 text-sm font-medium text-danger"
        >
          {place.error instanceof ApiError ? place.error.message : 'Couldn’t place the order. Try again.'}
        </p>
      )}

      <Button
        size="lg"
        fullWidth
        loading={place.isPending || place.isSuccess}
        disabled={!fees || Boolean(blocked) || quote.isFetching}
        onClick={() => place.mutate()}
      >
        {fees ? `Place order · ${formatINR(fees.totalPaise)}` : 'Place order'}
      </Button>
    </div>
  );
}
