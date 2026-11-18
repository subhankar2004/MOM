'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useCancelOrder, type Order } from '@/lib/orders';

/** Two taps to cancel (no accidental cancels in a pocket); explains the refund for UPI. */
export function CancelOrder({ order }: { order: Order }) {
  const [confirming, setConfirming] = useState(false);
  const cancel = useCancelOrder(order.id);
  const toast = useToast();
  const paid = order.paymentStatus === 'paid';

  if (!confirming) {
    return (
      <Button variant="ghost" onClick={() => setConfirming(true)}>
        Cancel order
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-col items-center gap-2 rounded-(--radius-card) border border-border p-4 text-center">
      <p className="font-semibold">Cancel this order?</p>
      {paid && (
        <p className="text-sm text-ink-muted">
          The full amount goes back to your UPI account, usually within 5–7 working days.
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setConfirming(false)} disabled={cancel.isPending}>
          Keep order
        </Button>
        <Button
          variant="danger"
          loading={cancel.isPending}
          onClick={() =>
            cancel.mutate(undefined, {
              onSuccess: () =>
                toast(paid ? 'Order cancelled. Refund started.' : 'Order cancelled.', 'success'),
              onError: (err) => {
                setConfirming(false);
                toast(err instanceof ApiError ? err.message : 'Could not cancel. Try again.', 'error');
              },
            })
          }
        >
          Yes, cancel
        </Button>
      </div>
    </div>
  );
}
