import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only buttons need a name for screen readers. */
  label: string;
  icon: ReactNode;
  tone?: 'default' | 'brand';
}

export function IconButton({
  label,
  icon,
  tone = 'default',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50',
        tone === 'brand' ? 'bg-brand text-brand-ink hover:bg-brand-hover' : 'text-ink hover:bg-surface-2',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
