import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon && <div className="text-ink-muted">{icon}</div>}
      <h2 className="font-display text-2xl font-bold">{title}</h2>
      {description && <p className="max-w-sm text-ink-muted">{description}</p>}
      {action}
    </div>
  );
}
