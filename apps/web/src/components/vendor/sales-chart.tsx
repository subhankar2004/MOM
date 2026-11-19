'use client';

import { StackedBars } from '@/components/charts/stacked-bars';
import type { StallReport } from '@/lib/vendor-reports';

type Day = StallReport['daily'][number];

const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekdayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' });
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

/** The stall's daily sales, UPI and cash stacked (spec §6.2 V8). */
export function SalesChart({ daily }: { daily: Day[] }) {
  const everyNth = daily.length <= 7 ? 1 : Math.ceil(daily.length / 6);
  return (
    <StackedBars
      title="Sales per day"
      listLabel="Sales per day"
      series={[
        { key: 'upi', label: 'UPI', className: 'bg-chart-upi' },
        { key: 'cash', label: 'Cash', className: 'bg-chart-cash' },
      ]}
      rows={daily.map((d, i) => ({
        id: d.day,
        tick:
          i % everyNth === 0 || i === daily.length - 1
            ? daily.length <= 7
              ? weekdayFmt.format(asDate(d.day))
              : dayFmt.format(asDate(d.day)).split(' ')[0]!
            : '',
        name: `${weekdayFmt.format(asDate(d.day))} ${dayFmt.format(asDate(d.day))}`,
        values: { upi: d.upiPaise, cash: d.cashPaise },
        note: d.orders === 1 ? '1 order' : `${d.orders} orders`,
      }))}
    />
  );
}
