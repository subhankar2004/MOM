import type { ReactNode } from 'react';
import { Card } from './card';

/** A labelled number for dashboards (vendor sales, admin revenue). */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="tabular font-display text-3xl font-bold">{value}</span>
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </Card>
  );
}
