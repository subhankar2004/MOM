'use client';

import { formatINR } from '@mom/shared';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface BarSeries<K extends string> {
  key: K;
  label: string;
  /** Tailwind background class from the validated chart tokens (bg-chart-upi / bg-chart-cash). */
  className: string;
}

export interface BarRow<K extends string> {
  id: string;
  /** Short axis label ("Mon", "18", "Nov"). Empty to skip a crowded label. */
  tick: string;
  /** Full name for tooltips and the table ("Wed 18 Nov"). */
  name: string;
  values: Record<K, number>;
  /** Extra tooltip / table line, e.g. "3 orders". */
  note?: string;
}

/** A round top for the scale: ₹1,234 → ₹1,500. */
export function niceMax(paise: number): number {
  if (paise <= 0) return 10_000;
  const rupees = paise / 100;
  const step = 10 ** Math.floor(Math.log10(rupees));
  const nice = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * step).find((v) => v >= rupees)!;
  return Math.round(nice * 100);
}

/**
 * Stacked bars in ₹ over time (vendor sales, admin revenue). One scale, thin bars with a flat
 * baseline and rounded top, a 2 px gap between parts, a legend, a tooltip on hover or keyboard
 * focus, and the same numbers as a table (dataviz rules: identity never by colour alone).
 */
export function StackedBars<K extends string>({
  title,
  listLabel,
  series,
  rows,
  footer,
}: {
  title: string;
  /** Accessible name of the bar list. */
  listLabel: string;
  /** Bottom segment first. */
  series: Array<BarSeries<K>>;
  rows: Array<BarRow<K>>;
  footer?: ReactNode;
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = (r: BarRow<K>) => series.reduce((s, x) => s + Math.max(0, r.values[x.key]), 0);
  const max = niceMax(Math.max(0, ...rows.map(total)));
  const parts = (r: BarRow<K>) => series.map((s) => `${s.label} ${formatINR(r.values[s.key])}`).join(', ');

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{title}</span>
        <span className="flex gap-4 text-sm text-ink-muted" aria-hidden>
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className={cn('size-3 rounded-sm', s.className)} /> {s.label}
            </span>
          ))}
        </span>
      </figcaption>

      <div className="relative pl-14">
        <div
          aria-hidden
          className="tabular absolute top-0 left-0 w-12 -translate-y-1/2 text-right text-xs text-ink-muted"
        >
          {formatINR(max, { compact: true })}
        </div>
        <div aria-hidden className="absolute top-0 right-0 left-14 border-t border-dashed border-border" />
        <ul className="flex h-44 items-end gap-1 border-b border-ink-muted/40" aria-label={listLabel}>
          {rows.map((r, i) => {
            const visible = [...series].reverse().filter((s) => r.values[s.key] > 0);
            return (
              <li
                key={r.id}
                tabIndex={0}
                aria-label={`${r.name}: ${formatINR(total(r))}${r.note ? ` from ${r.note}` : ''} (${parts(r)})`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end rounded-sm outline-none focus-visible:bg-surface-2"
              >
                <div className="flex h-full w-full max-w-6 flex-col justify-end">
                  {visible.map((s, j) => (
                    <div key={s.key} className="contents">
                      {j > 0 && <div className="h-0.5 w-full shrink-0 bg-surface" />}
                      <div
                        className={cn('w-full', s.className, j === 0 && 'rounded-t-[4px]')}
                        style={{ height: `${(r.values[s.key] / max) * 100}%` }}
                      />
                    </div>
                  ))}
                </div>
                {active === i && (
                  <div
                    role="tooltip"
                    className={cn(
                      'pointer-events-none absolute bottom-full z-10 mb-2 w-48 rounded-(--radius-control) bg-ink p-2 text-xs text-bg shadow-lg',
                      i < rows.length / 2 ? 'left-0' : 'right-0',
                    )}
                  >
                    <p className="font-semibold">{r.name}</p>
                    <p className="tabular">
                      {formatINR(total(r))}
                      {r.note && ` · ${r.note}`}
                    </p>
                    {series.map((s) => (
                      <p key={s.key} className="tabular">
                        {s.label} {formatINR(r.values[s.key])}
                      </p>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div aria-hidden className="mt-1 flex gap-1 text-xs text-ink-muted">
          {rows.map((r) => (
            <span
              key={r.id}
              className="flex min-w-0 flex-1 justify-center overflow-visible whitespace-nowrap"
            >
              {r.tick}
            </span>
          ))}
        </div>
      </div>

      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer content-center font-semibold">Show as a table</summary>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-ink-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">Date</th>
                {rows.some((r) => r.note) && <th className="py-1 pr-3 text-right font-medium">Details</th>}
                <th className="py-1 pr-3 text-right font-medium">Total</th>
                {series.map((s) => (
                  <th key={s.key} className="py-1 pr-3 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-1 pr-3">{r.name}</td>
                  {rows.some((x) => x.note) && <td className="py-1 pr-3 text-right">{r.note}</td>}
                  <td className="py-1 pr-3 text-right">{formatINR(total(r))}</td>
                  {series.map((s) => (
                    <td key={s.key} className="py-1 pr-3 text-right">
                      {formatINR(r.values[s.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {footer}
    </figure>
  );
}
