'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { TextField } from '@/components/ui/text-field';
import { cn } from '@/lib/cn';
import type { BoardOrder } from '@/lib/vendor-orders';

const REASONS = ['An item ran out', 'Too busy right now', 'Closing for the day'] as const;
const OTHER = 'Other';

/** Ask why before rejecting: the student sees the reason, and a UPI payment is refunded. */
export function RejectSheet({
  order,
  onClose,
  onConfirm,
  pending,
}: {
  order: BoardOrder | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  pending: boolean;
}) {
  const [choice, setChoice] = useState<string>(REASONS[0]);
  const [other, setOther] = useState('');
  const reason = choice === OTHER ? other.trim() : choice;
  const valid = reason.length >= 3;
  const refunds = order?.paymentMethod === 'upi' && order.paymentStatus === 'paid';

  return (
    <Sheet
      open={order !== null}
      onClose={onClose}
      title={order ? `Reject token #${order.tokenNo}?` : 'Reject'}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onConfirm(reason);
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-semibold">Tell the student why</legend>
          {[...REASONS, OTHER].map((r) => (
            <label
              key={r}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-3 rounded-(--radius-control) border px-3',
                choice === r ? 'border-brand bg-surface-2' : 'border-border',
              )}
            >
              <input
                type="radio"
                name="reason"
                value={r}
                checked={choice === r}
                onChange={() => setChoice(r)}
                className="size-4 accent-(--brand)"
              />
              {r}
            </label>
          ))}
        </fieldset>
        {choice === OTHER && (
          <TextField
            label="Reason"
            value={other}
            maxLength={200}
            onChange={(e) => setOther(e.target.value)}
            autoFocus
            error={other && !valid ? 'At least 3 characters' : undefined}
          />
        )}
        <p className="text-sm text-ink-muted">
          {refunds
            ? 'The student paid by UPI. The full amount is refunded automatically.'
            : 'This is a cash order, so nothing was paid yet.'}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Keep order
          </Button>
          <Button type="submit" variant="danger" loading={pending} disabled={!valid}>
            Reject order
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
