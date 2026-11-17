'use client';

import { formatBps, formatINR, type FeeBreakdown } from '@mom/shared';
import { AlertTriangle, ArrowLeft, Banknote, ShoppingBag, Smartphone, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useId } from 'react';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { QtyStepper } from '@/components/ui/qty-stepper';
import { Skeleton } from '@/components/ui/skeleton';
import { VegDot } from '@/components/ui/veg-dot';
import { ApiError } from '@/lib/api-client';
import { cartStore, MAX_NOTE, useCart, type CartLine } from '@/lib/cart';
import { cn } from '@/lib/cn';
import { useCartQuote, type CartQuote } from '@/lib/quote';

type QuoteLine = CartQuote['lines'][number];

function LineRow({ line, quote }: { line: CartLine; quote: QuoteLine | undefined }) {
  const cart = useCart();
  const status = quote?.status ?? 'ok';
  const gone = status === 'unavailable' || status === 'removed';
  const unit = quote?.unitPricePaise ?? line.pricePaise;
  return (
    <li className="flex flex-col gap-2 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {line.isVeg !== undefined && <VegDot veg={line.isVeg} />}
          <span className={cn('font-semibold', gone && 'text-ink-muted line-through')}>{line.name}</span>
        </div>
        <span className="tabular font-semibold">
          {gone ? '—' : formatINR(unit * line.quantity, { compact: true })}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="tabular text-sm text-ink-muted">{formatINR(unit, { compact: true })} each</span>
        {gone ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<Trash2 size={16} aria-hidden />}
            onClick={() => cartStore.remove(line.itemId)}
          >
            Remove
          </Button>
        ) : (
          <QtyStepper
            itemName={line.name}
            value={line.quantity}
            onChange={(n) => cart.stall && cartStore.setQuantity(cart.stall, line, n)}
          />
        )}
      </div>
      {status === 'price_changed' && typeof quote?.previousPricePaise === 'number' && (
        <p className="rounded-(--radius-control) bg-warning-soft px-3 py-2 text-sm text-ink">
          <span className="font-semibold">Price changed</span> from{' '}
          <span className="tabular line-through">
            {formatINR(quote.previousPricePaise, { compact: true })}
          </span>{' '}
          to <span className="tabular font-semibold">{formatINR(unit, { compact: true })}</span>
        </p>
      )}
      {status === 'unavailable' && (
        <p className="text-sm font-semibold text-danger">Sold out now — remove it to continue.</p>
      )}
      {status === 'removed' && (
        <p className="text-sm font-semibold text-danger">No longer on the menu — remove it to continue.</p>
      )}
    </li>
  );
}

function PayOption({
  icon,
  title,
  fees,
  rates,
}: {
  icon: React.ReactNode;
  title: string;
  fees: FeeBreakdown;
  rates: CartQuote['rates'];
}) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-1.5 rounded-(--radius-control) border border-border p-3"
    >
      <span className="flex items-center gap-2 font-semibold">
        {icon} {title}
      </span>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-muted">Item total</dt>
        <dd className="tabular text-right">{formatINR(fees.subtotalPaise)}</dd>
        <dt className="text-ink-muted">Platform fee ({formatBps(rates.platformFeeBps)})</dt>
        <dd className="tabular text-right">{formatINR(fees.platformFeePaise)}</dd>
        {fees.cashFeePaise > 0 && (
          <>
            <dt className="text-ink-muted">Cash handling fee ({formatBps(rates.cashFeeBps)})</dt>
            <dd className="tabular text-right">{formatINR(fees.cashFeePaise)}</dd>
          </>
        )}
        <dt className="font-bold">You pay</dt>
        <dd className="tabular text-right font-display text-xl font-bold">{formatINR(fees.totalPaise)}</dd>
      </dl>
    </section>
  );
}

const PROBLEM_TEXT: Partial<Record<CartQuote['problems'][number], string>> = {
  stall_closed: 'The stall is closed right now, so this order can’t be placed yet.',
  stall_paused: 'The stall isn’t taking new orders right now. Try again in a few minutes.',
  no_payment_method: 'The stall isn’t accepting payments right now.',
};

/** The cart (spec §6.1 S4): edit dishes, add a note, see the bill — re-priced by the server. */
export function CartView() {
  const cart = useCart();
  const quote = useCartQuote(cart);
  const noteId = useId();

  if (!cart.stall || cart.lines.length === 0) {
    return (
      <EmptyState
        as="h1"
        icon={<ShoppingBag size={36} aria-hidden />}
        title="Your cart is empty"
        description="Pick a stall and add a dish — it shows up here."
        action={<ButtonLink href="/">Browse stalls</ButtonLink>}
      />
    );
  }

  const q = quote.data;
  const changed = q?.lines.filter((l) => l.status === 'price_changed') ?? [];
  const stallGone = quote.error instanceof ApiError && quote.error.status === 404;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/stalls/${cart.stall.slug}`}
        className="inline-flex items-center gap-1 self-start text-sm font-semibold text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden /> Back to {cart.stall.name}
      </Link>
      <h1 className="font-display text-3xl font-black">Your cart</h1>

      {stallGone && (
        <Card className="flex flex-col gap-3 p-4">
          <p className="font-semibold">
            {cart.stall.name} is no longer on MOM, so this cart can’t be ordered.
          </p>
          <Button variant="secondary" onClick={() => cartStore.clear()}>
            Clear cart
          </Button>
        </Card>
      )}

      {changed.length > 0 && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-(--radius-card) border border-warning bg-warning-soft p-4"
        >
          <p className="flex items-start gap-2">
            <AlertTriangle size={20} aria-hidden className="mt-0.5 shrink-0 text-warning" />
            <span>
              <span className="font-semibold">
                {changed.length === 1 ? 'A price has changed' : `${changed.length} prices have changed`}
              </span>{' '}
              since you added {changed.length === 1 ? 'it' : 'them'}. The bill below uses the new prices.
            </span>
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() =>
              cartStore.acceptPrices(
                changed.map((l) => ({ itemId: l.itemId, unitPricePaise: l.unitPricePaise! })),
              )
            }
          >
            Accept new prices
          </Button>
        </div>
      )}

      <Card className="px-4">
        <ul className="divide-y divide-border" aria-label={`Dishes from ${cart.stall.name}`}>
          {cart.lines.map((line) => (
            <LineRow key={line.itemId} line={line} quote={q?.lines.find((l) => l.itemId === line.itemId)} />
          ))}
        </ul>
      </Card>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={noteId} className="text-sm font-semibold">
          Note for the stall <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <textarea
          id={noteId}
          value={cart.note}
          onChange={(e) => cartStore.setNote(e.target.value)}
          maxLength={MAX_NOTE}
          rows={2}
          placeholder="Less spicy, no onion…"
          className="rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-base placeholder:text-ink-muted"
        />
        <span className="tabular self-end text-xs text-ink-muted" aria-live="polite">
          {cart.note.length}/{MAX_NOTE}
        </span>
      </div>

      <section aria-labelledby="bill" className="flex flex-col gap-3">
        <h2 id="bill" className="font-display text-2xl font-bold">
          Bill
        </h2>
        {quote.isPending && (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        )}
        {quote.isError && !stallGone && (
          <Card className="flex flex-col gap-3 p-4">
            <p>
              Couldn’t check prices right now. {quote.error instanceof ApiError ? quote.error.message : ''}
            </p>
            <Button variant="secondary" onClick={() => quote.refetch()} className="self-start">
              Try again
            </Button>
          </Card>
        )}
        {q && (
          <>
            {q.options.upi && (
              <PayOption
                icon={<Smartphone size={18} aria-hidden />}
                title="Pay by UPI"
                fees={q.options.upi}
                rates={q.rates}
              />
            )}
            {q.options.cash && (
              <PayOption
                icon={<Banknote size={18} aria-hidden />}
                title="Pay in cash at the counter"
                fees={q.options.cash}
                rates={q.rates}
              />
            )}
            {!q.options.upi && q.subtotalPaise > 0 && (
              <p className="text-sm text-ink-muted">{cart.stall.name} doesn’t take UPI yet.</p>
            )}
            {q.problems
              .map((p) => PROBLEM_TEXT[p])
              .filter(Boolean)
              .map((text) => (
                <p
                  key={text}
                  role="status"
                  className="rounded-(--radius-control) bg-surface-2 px-3 py-2 text-sm font-semibold"
                >
                  {text}
                </p>
              ))}
          </>
        )}
      </section>

      <div className="flex flex-col gap-2">
        {q?.canCheckout ? (
          <ButtonLink href="/checkout" size="lg" fullWidth>
            Continue to payment
          </ButtonLink>
        ) : (
          <Button size="lg" fullWidth disabled>
            Continue to payment
          </Button>
        )}
        <Button variant="ghost" icon={<Trash2 size={18} aria-hidden />} onClick={() => cartStore.clear()}>
          Empty cart
        </Button>
      </div>
    </div>
  );
}
