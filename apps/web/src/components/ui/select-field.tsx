'use client';

import { useId } from 'react';
import { cn } from '@/lib/cn';

/** Labelled native <select> (filters, roles). */
export function SelectField<V extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: V;
  onChange: (value: V) => void;
  options: Array<{ value: V; label: string }>;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as V)}
        className="h-12 rounded-(--radius-control) border border-border bg-surface px-3"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
