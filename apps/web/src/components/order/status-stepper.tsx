import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Order } from '@/lib/orders';

const STEPS = [
  { key: 'placed', label: 'Placed' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'collected', label: 'Collected' },
] as const;

/** Where the order is: Placed → Preparing → Ready → Collected (spec §6.1 S6). */
export function StatusStepper({ status }: { status: Order['status'] }) {
  const current = STEPS.findIndex((s) => s.key === status);
  if (current < 0) return null; // waiting for payment, cancelled, expired: not on this track
  return (
    <ol aria-label="Order progress" className="flex w-full items-start">
      {STEPS.map((step, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li
            key={step.key}
            aria-current={now ? 'step' : undefined}
            className="relative flex flex-1 flex-col items-center gap-1.5 text-center"
          >
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  'absolute top-3.5 right-1/2 h-0.5 w-full -translate-y-1/2',
                  i <= current ? 'bg-brand' : 'bg-border',
                )}
              />
            )}
            <span
              className={cn(
                'relative z-10 flex size-7 items-center justify-center rounded-full border-2 text-xs font-bold',
                done && 'border-brand bg-brand text-brand-ink',
                now &&
                  (step.key === 'ready'
                    ? 'border-success bg-success text-white dark:text-[#0f1230]'
                    : 'border-brand bg-haldi text-haldi-ink'),
                !done && !now && 'border-border bg-surface text-ink-muted',
              )}
            >
              {done ? <Check size={14} aria-hidden /> : i + 1}
            </span>
            <span
              className={cn('text-xs', now ? 'font-bold text-ink' : done ? 'text-ink' : 'text-ink-muted')}
            >
              {step.label}
              <span className="sr-only">{done ? ' (done)' : now ? ' (now)' : ''}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
