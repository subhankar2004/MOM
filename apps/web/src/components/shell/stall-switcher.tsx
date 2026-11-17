'use client';

import { Store } from 'lucide-react';
import { selectStall, useCurrentStall } from '@/lib/vendor-stall';

/**
 * The stall this console is working on. A picker only for people who manage several
 * stalls (spec V2); otherwise just the name.
 */
export function StallSwitcher() {
  const { stalls, current } = useCurrentStall();
  if (stalls.length === 1) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <Store size={20} aria-hidden className="shrink-0 text-ink-muted" />
        <span className="truncate font-display text-lg font-bold">{current.name}</span>
      </span>
    );
  }
  return (
    <label className="flex min-w-0 items-center gap-2">
      <Store size={20} aria-hidden className="shrink-0 text-ink-muted" />
      <span className="sr-only">Stall</span>
      <select
        value={current.id}
        onChange={(e) => selectStall(e.target.value)}
        className="h-10 min-w-0 truncate rounded-(--radius-control) border border-border bg-surface px-2 font-display text-lg font-bold"
      >
        {stalls.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
