import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  description,
  action,
  as: Heading = 'h2',
}: {
  /** h1 when the empty state is the whole page (404, no access). */
  as?: 'h1' | 'h2';
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon && <div className="text-ink-muted">{icon}</div>}
      <Heading className="font-display text-2xl font-bold">{title}</Heading>
      {description && <p className="max-w-sm text-ink-muted">{description}</p>}
      {action}
    </div>
  );
}
