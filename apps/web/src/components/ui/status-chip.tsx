import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type ChipTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'haldi';

const tones: Record<ChipTone, string> = {
  neutral: 'bg-surface-2 text-ink-muted',
  brand: 'bg-brand text-brand-ink',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  haldi: 'bg-haldi-soft text-ink',
};

/** Small status label. Always carries text, so status never depends on colour alone. */
export function StatusChip({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: ChipTone;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        tones[tone],
      )}
    >
      {icon}
      {children}
    </span>
  );
}
