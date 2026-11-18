'use client';

import { formatINR } from '@mom/shared';
import { Smartphone, TimerOff } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ApiError } from '@/lib/api-client';
import type { Order } from '@/lib/orders';
import { PaymentDismissed, usePayOrder } from '@/lib/razorpay';

function useCountdown(until: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  if (!until) return null;
  const left = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  return { left, label: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` };
}

/** "Pay ₹131.30 by UPI" for an order waiting for payment (spec §4.2). */
export function PaymentPanel({ order }: { order: Order }) {
  const pay = usePayOrder(order);
  const countdown = useCountdown(order.expiresAt);
  const params = useSearchParams();
  const router = useRouter();
  const autoStarted = useRef(false);

  // Coming straight from checkout (?pay=1): open the payment window once.
  useEffect(() => {
    if (params.get('pay') === '1' && !autoStarted.current) {
      autoStarted.current = true;
      router.replace(`/orders/${order.id}`); // a reload shouldn't reopen it
      pay.mutate();
    }
  }, [params, pay, router, order.id]);

  if (order.status === 'expired' || countdown?.left === 0) {
    return (
      <Card className="flex w-full flex-col items-center gap-3 p-5 text-center">
        <TimerOff size={32} aria-hidden className="text-ink-muted" />
        <p className="font-display text-2xl font-bold">Payment time ran out</p>
        <p className="text-ink-muted">
          This order was cancelled because it wasn’t paid within 15 minutes. You weren’t charged.
        </p>
        <ButtonLink href={`/stalls/${order.stall.slug}`}>Order again</ButtonLink>
      </Card>
    );
  }

  const error = pay.error;
  return (
    <Card className="flex w-full flex-col items-center gap-3 p-5 text-center">
      <p className="font-display text-2xl font-bold">Pay to get your token</p>
      <p className="text-ink-muted">
        Your token number appears as soon as the payment goes through.
        {countdown && (
          <>
            {' '}
            Pay within <span className="tabular font-semibold text-ink">{countdown.label}</span>.
          </>
        )}
      </p>
      {error && (
        <p
          role="alert"
          className="w-full rounded-(--radius-control) bg-warning-soft px-3 py-2 text-sm font-medium"
        >
          {error instanceof PaymentDismissed || error instanceof ApiError
            ? error.message
            : 'Payment didn’t go through. Try again.'}
        </p>
      )}
      <Button
        size="lg"
        fullWidth
        icon={<Smartphone size={20} aria-hidden />}
        loading={pay.isPending}
        onClick={() => pay.mutate()}
      >
        {error ? 'Try again' : 'Pay'} {formatINR(order.totalPaise)} by UPI
      </Button>
      <p className="text-xs text-ink-muted">Payments are handled securely by Razorpay.</p>
    </Card>
  );
}
