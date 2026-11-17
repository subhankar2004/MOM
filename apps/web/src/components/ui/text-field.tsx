'use client';

import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label: string;
  hint?: string;
  error?: string;
  /** Shown before the input, e.g. "+91". */
  leading?: ReactNode;
}

/** Labelled input with hint and error text wired up for screen readers. */
export function TextField({ label, hint, error, leading, className, id, ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-sm font-semibold">
        {label}
      </label>
      <div
        className={cn(
          'flex h-12 items-center gap-2 rounded-(--radius-control) border bg-surface px-3 focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus',
          error ? 'border-danger' : 'border-border',
        )}
      >
        {leading && <span className="text-ink-muted">{leading}</span>}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-muted"
          {...rest}
        />
      </div>
      {hint && !error && (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
