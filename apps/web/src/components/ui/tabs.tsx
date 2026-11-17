'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
}

/**
 * Accessible tabs (WAI-ARIA tablist): arrow keys move between tabs, Home/End jump.
 * Controlled: the parent owns `value` and renders the matching panel via `children`.
 */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
  children,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(e: KeyboardEvent, index: number) {
    const last = items.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : e.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    onChange(items[next]!.key);
    refs.current[next]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-border">
        {items.map((item, i) => {
          const selected = item.key === value;
          return (
            <button
              key={item.key}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="tab"
              type="button"
              id={`${id}-tab-${item.key}`}
              aria-selected={selected}
              aria-controls={`${id}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.key)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                '-mb-px h-11 shrink-0 border-b-3 px-3 text-sm font-semibold whitespace-nowrap transition-colors',
                selected ? 'border-brand text-ink' : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${value}`} className="pt-4">
        {children}
      </div>
    </div>
  );
}
