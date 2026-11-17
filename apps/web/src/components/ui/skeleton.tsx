import { cn } from '@/lib/cn';

/** Placeholder block shown while content loads. Reserves space to avoid layout shift. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('animate-pulse rounded-(--radius-control) bg-surface-2', className)} />
  );
}
