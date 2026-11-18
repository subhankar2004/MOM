import { formatINR } from '@mom/shared';
import { MessageSquareText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/ui/status-chip';
import { cn } from '@/lib/cn';
import { elapsedLabel } from '@/lib/time';
import type { BoardAction, BoardOrder } from '@/lib/vendor-orders';

/** Minutes after which a waiting order is flagged as running late. */
const LATE_MINUTES = 15;

/**
 * One ticket on the counter board, built to be read at arm's length on a tablet:
 * the token first, then exactly what to cook, then how it's paid.
 */
export function OrderCard({
  order: o,
  now,
  busy,
  onAction,
  onReject,
}: {
  order: BoardOrder;
  now: Date;
  busy: boolean;
  onAction: (action: Exclude<BoardAction, 'reject'>) => void;
  onReject: () => void;
}) {
  const since = o.status === 'ready' ? o.readyAt : o.placedAt;
  const minutes = since ? (now.getTime() - new Date(since).getTime()) / 60_000 : 0;
  const late = o.status !== 'ready' && minutes >= LATE_MINUTES;
  const paid = o.paymentMethod === 'upi' && o.paymentStatus === 'paid';

  return (
    <article
      aria-label={`Token ${o.tokenNo}`}
      className={cn(
        'flex flex-col gap-3 rounded-(--radius-card) border-2 bg-surface p-4',
        late ? 'border-warning' : o.status === 'ready' ? 'border-success' : 'border-border',
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <p className="tabular font-display text-4xl leading-none font-black">#{o.tokenNo}</p>
        <div className="flex flex-col items-end gap-1 text-right">
          {paid ? (
            <StatusChip tone="success">UPI paid</StatusChip>
          ) : (
            <StatusChip tone="haldi">Cash due {formatINR(o.totalPaise)}</StatusChip>
          )}
          {since && (
            <span className={cn('text-sm', late ? 'font-semibold text-warning' : 'text-ink-muted')}>
              {o.status === 'ready' ? 'Ready ' : ''}
              {elapsedLabel(new Date(since), now)}
              {o.status === 'ready' ? ' ago' : late ? ' waiting' : ''}
            </span>
          )}
        </div>
      </header>

      <ul className="flex flex-col gap-0.5 text-lg">
        {o.items.map((i, idx) => (
          <li key={idx}>
            <span className="tabular font-bold">{i.quantity} ×</span> {i.name}
          </li>
        ))}
      </ul>

      {o.note && (
        <p className="flex gap-2 rounded-(--radius-control) bg-haldi-soft px-3 py-2 text-sm">
          <MessageSquareText size={16} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            <span className="sr-only">Note from the student: </span>“{o.note}”
          </span>
        </p>
      )}

      {o.status === 'ready' ? (
        <p className="text-sm text-ink-muted">Waiting for the student to collect it.</p>
      ) : (
        <div className="flex gap-2">
          {o.status === 'placed' ? (
            <Button size="lg" fullWidth loading={busy} onClick={() => onAction('accept')}>
              Accept
            </Button>
          ) : (
            <Button size="lg" variant="haldi" fullWidth loading={busy} onClick={() => onAction('ready')}>
              Mark ready
            </Button>
          )}
          <Button size="lg" variant="secondary" disabled={busy} onClick={onReject}>
            Reject
          </Button>
        </div>
      )}
    </article>
  );
}
