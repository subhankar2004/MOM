'use client';

import { Store } from 'lucide-react';
import { useState } from 'react';

// Placeholder data until stall access arrives with auth (#9): owners see only their own stalls.
const DEMO_STALLS = [
  { id: 'dosa-corner', name: 'Dosa Corner' },
  { id: 'chai-and-rolls', name: 'Chai & Rolls' },
];

/** Shown only to owners of several stalls; every vendor page is scoped to the selected one. */
export function StallSwitcher() {
  const [stall, setStall] = useState(DEMO_STALLS[0]!.id);
  return (
    <label className="flex min-w-0 items-center gap-2">
      <Store size={20} aria-hidden className="shrink-0 text-ink-muted" />
      <span className="sr-only">Stall</span>
      <select
        value={stall}
        onChange={(e) => setStall(e.target.value)}
        className="h-10 min-w-0 truncate rounded-(--radius-control) border border-border bg-surface px-2 font-display text-lg font-bold"
      >
        {DEMO_STALLS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
