'use client';

import { formatINR } from '@mom/shared';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import type { StallReport } from '@/lib/vendor-reports';

type Day = StallReport['daily'][number];

const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekdayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' });
const label = (day: string) => dayFmt.format(new Date(`${day}T00:00:00Z`));

/** A round top for the scale: ₹1,234 → ₹1,500. */
function niceMax(paise: number): number {
  if (paise <= 0) return 10_000;
  const rupees = paise / 100;
  const step = 10 ** Math.floor(Math.log10(rupees));
  const nice = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * step).find((v) => v >= rupees)!;
  return Math.round(nice * 100);
}

/**
 * Daily sales, UPI and cash stacked (spec §6.2 V8). One scale, thin bars with a flat baseline
 * and rounded top, a 2 px gap between the two parts, a legend, a tooltip on hover or keyboard
 * focus, and the same numbers as a table.
 */
export function SalesChart({ daily }: { daily: Day[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(...daily.map((d) => d.grossPaise)));
  const everyNth = daily.length <= 7 ? 1 : Math.ceil(daily.length / 6);
  const showWeekday = daily.length <= 7;

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">Sales per day</span>
        <span className="flex gap-4 text-sm text-ink-muted" aria-hidden>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-chart-upi" /> UPI
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-chart-cash" /> Cash
          </span>
        </span>
      </figcaption>

      <div className="relative pl-14">
        {/* Scale: the top value and the baseline only (recessive). */}
        <div
          aria-hidden
          className="tabular absolute top-0 left-0 w-12 -translate-y-1/2 text-right text-xs text-ink-muted"
        >
          {formatINR(max, { compact: true })}
        </div>
        <div aria-hidden className="absolute top-0 right-0 left-14 border-t border-dashed border-border" />
        <ul className="flex h-44 items-end gap-1 border-b border-ink-muted/40" aria-label="Sales per day">
          {daily.map((d, i) => {
            const upiH = (d.upiPaise / max) * 100;
            const cashH = (d.cashPaise / max) * 100;
            const both = d.upiPaise > 0 && d.cashPaise > 0;
            return (
              <li
                key={d.day}
                tabIndex={0}
                aria-label={`${label(d.day)}: ${formatINR(d.grossPaise)} from ${d.orders} ${d.orders === 1 ? 'order' : 'orders'} (UPI ${formatINR(d.upiPaise)}, cash ${formatINR(d.cashPaise)})`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                // The whole column is the hover target, wider than the bar itself.
                className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end rounded-sm outline-none focus-visible:bg-surface-2"
              >
                <div className="flex h-full w-full max-w-6 flex-col justify-end">
                  {d.cashPaise > 0 && (
                    <div className="w-full rounded-t-[4px] bg-chart-cash" style={{ height: `${cashH}%` }} />
                  )}
                  {both && <div className="h-0.5 w-full shrink-0 bg-surface" />}
                  {d.upiPaise > 0 && (
                    <div
                      className={cn('w-full bg-chart-upi', !both && 'rounded-t-[4px]')}
                      style={{ height: `${upiH}%` }}
                    />
                  )}
                </div>
                {active === i && (
                  <div
                    role="tooltip"
                    className={cn(
                      'pointer-events-none absolute bottom-full z-10 mb-2 w-44 rounded-(--radius-control) bg-ink p-2 text-xs text-bg shadow-lg',
                      i < daily.length / 2 ? 'left-0' : 'right-0',
                    )}
                  >
                    <p className="font-semibold">
                      {weekdayFmt.format(new Date(`${d.day}T00:00:00Z`))} {label(d.day)}
                    </p>
                    <p className="tabular">
                      {formatINR(d.grossPaise)} · {d.orders} {d.orders === 1 ? 'order' : 'orders'}
                    </p>
                    <p className="tabular">UPI {formatINR(d.upiPaise)}</p>
                    <p className="tabular">Cash {formatINR(d.cashPaise)}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div aria-hidden className="mt-1 flex gap-1 text-xs text-ink-muted">
          {daily.map((d, i) => (
            <span key={d.day} className="min-w-0 flex-1 truncate text-center">
              {i % everyNth === 0 || i === daily.length - 1
                ? showWeekday
                  ? weekdayFmt.format(new Date(`${d.day}T00:00:00Z`))
                  : label(d.day).split(' ')[0]
                : ''}
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
                <th className="py-1 pr-3 text-right font-medium">Orders</th>
                <th className="py-1 pr-3 text-right font-medium">Sales</th>
                <th className="py-1 pr-3 text-right font-medium">UPI</th>
                <th className="py-1 text-right font-medium">Cash</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {daily.map((d) => (
                <tr key={d.day} className="border-t border-border">
                  <td className="py-1 pr-3">{label(d.day)}</td>
                  <td className="py-1 pr-3 text-right">{d.orders}</td>
                  <td className="py-1 pr-3 text-right">{formatINR(d.grossPaise)}</td>
                  <td className="py-1 pr-3 text-right">{formatINR(d.upiPaise)}</td>
                  <td className="py-1 text-right">{formatINR(d.cashPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
