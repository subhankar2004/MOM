import { cn } from '@/lib/cn';

export type CongestionLevel = 'low' | 'moderate' | 'busy';

const LEVELS: Record<CongestionLevel, { label: string; bars: number; color: string }> = {
  low: { label: 'Not busy', bars: 1, color: 'bg-success' },
  moderate: { label: 'Moderate', bars: 2, color: 'bg-warning' },
  busy: { label: 'Busy', bars: 3, color: 'bg-danger' },
};

/** How busy a stall is (spec §10): bars + words + wait time, never colour alone. */
export function CongestionMeter({ level, waitMinutes }: { level: CongestionLevel; waitMinutes: number }) {
  const l = LEVELS[level];
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className="sr-only">{`${l.label}, about ${waitMinutes} minute wait`}</span>
      <span className="flex items-end gap-0.5" aria-hidden>
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={cn('w-1.5 rounded-sm', n <= l.bars ? l.color : 'bg-border')}
            style={{ height: 4 + n * 4 }}
          />
        ))}
      </span>
      <span aria-hidden>
        <span className="font-semibold">{l.label}</span>
        <span className="text-ink-muted"> · ~{waitMinutes} min</span>
      </span>
    </span>
  );
}
