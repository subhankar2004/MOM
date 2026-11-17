import Link, { type LinkProps } from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'haldi';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-(--radius-control) font-semibold whitespace-nowrap ' +
  'transition-colors disabled:cursor-not-allowed disabled:opacity-55 select-none';

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink hover:bg-brand-hover',
  haldi: 'bg-haldi text-haldi-ink hover:brightness-95',
  secondary: 'border border-border bg-surface text-ink hover:bg-surface-2',
  ghost: 'text-ink hover:bg-surface-2',
  danger: 'bg-danger text-white hover:brightness-95 dark:text-[#2a0d0b]',
};

// Every size keeps a ≥44 px touch target except sm (used inside dense tables).
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-base',
  lg: 'h-13 px-6 text-lg',
};

export function buttonClasses(variant: Variant = 'primary', size: Size = 'md', fullWidth = false) {
  return cn(base, variants[variant], sizes[size], fullWidth && 'w-full');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth,
  loading,
  icon,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonClasses(variant, size, fullWidth), className)}
      {...rest}
    >
      {loading ? <Spinner size={18} /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink<T extends string>({
  variant = 'primary',
  size = 'md',
  fullWidth,
  className,
  children,
  ...rest
}: LinkProps<T> & {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link className={cn(buttonClasses(variant, size, fullWidth), className)} {...rest}>
      {children}
    </Link>
  );
}
