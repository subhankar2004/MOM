'use client';

import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface QtyStepperProps {
  /** What is being added, e.g. "Masala Dosa" — used in the button labels. */
  itemName: string;
  value: number;
  onChange: (next: number) => void;
  max?: number;
  disabled?: boolean;
}

/** "Add" until the item is in the cart, then − n +. */
export function QtyStepper({ itemName, value, onChange, max = 20, disabled }: QtyStepperProps) {
  if (value === 0) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(1)}
        aria-label={`Add ${itemName}`}
        className="h-10 min-w-24 rounded-(--radius-control) border-2 border-brand bg-surface px-4 font-bold text-brand transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:border-border disabled:text-ink-muted"
      >
        Add
      </button>
    );
  }
  const btn = 'flex size-10 items-center justify-center rounded-(--radius-control) disabled:opacity-40';
  return (
    <div
      role="group"
      aria-label={`Quantity of ${itemName}`}
      className={cn(
        'flex h-10 min-w-24 items-center justify-between rounded-(--radius-control) bg-brand text-brand-ink',
      )}
    >
      <button
        type="button"
        className={btn}
        aria-label={`Remove one ${itemName}`}
        onClick={() => onChange(value - 1)}
        disabled={disabled}
      >
        <Minus size={18} aria-hidden />
      </button>
      <span className="tabular min-w-5 text-center font-bold" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className={btn}
        aria-label={`Add one more ${itemName}`}
        onClick={() => onChange(value + 1)}
        disabled={disabled || value >= max}
      >
        <Plus size={18} aria-hidden />
      </button>
    </div>
  );
}
