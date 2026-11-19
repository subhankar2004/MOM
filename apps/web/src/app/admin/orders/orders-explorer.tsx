'use client';

import { formatINR } from '@mom/shared';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { OrderStatusChip, PaymentStatusChip, SHORT_STATUS } from '@/components/order/order-status-chip';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { SelectField } from '@/components/ui/select-field';
import { Skeleton } from '@/components/ui/skeleton';
import { TextField } from '@/components/ui/text-field';
import { useAdminOrders, type AdminOrderRow, type OrderFilter } from '@/lib/admin-console';
import { useAdminStalls } from '@/lib/admin-stalls';
import type { Order } from '@/lib/orders';
import { formatDateTime } from '@/lib/time';

const EMPTY: OrderFilter = {
  q: '',
  stallId: '',
  status: '',
  paymentMethod: '',
  paymentStatus: '',
  from: '',
  to: '',
};

/** Every order (spec §6.3 A5): search and filter, then open one for its timeline and actions. */
export function OrdersExplorer() {
  const [filter, setFilter] = useState<OrderFilter>(EMPTY);
  const deferred = useDeferredValue(filter);
  const orders = useAdminOrders(deferred);
  const stalls = useAdminStalls({ q: '', status: 'all' });
  const rows = orders.data?.pages.flatMap((p) => p.orders) ?? [];
  const set =
    <K extends keyof OrderFilter>(key: K) =>
    (value: OrderFilter[K]) =>
      setFilter((f) => ({ ...f, [key]: value }));
  const filtered = JSON.stringify(filter) !== JSON.stringify(EMPTY);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl font-bold">Orders</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label="Search"
          leading={<Search size={18} aria-hidden />}
          placeholder="#token, phone, name or order id"
          value={filter.q}
          onChange={(e) => set('q')(e.target.value)}
          className="sm:col-span-2"
        />
        <SelectField
          label="Stall"
          value={filter.stallId}
          onChange={set('stallId')}
          options={[
            { value: '', label: 'All stalls' },
            ...(stalls.data ?? []).map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <SelectField
          label="Status"
          value={filter.status}
          onChange={set('status')}
          options={[
            { value: '', label: 'Any status' },
            ...(Object.keys(SHORT_STATUS) as Order['status'][]).map((s) => ({
              value: s,
              label: SHORT_STATUS[s],
            })),
          ]}
        />
        <SelectField
          label="Payment"
          value={filter.paymentMethod}
          onChange={set('paymentMethod')}
          options={[
            { value: '', label: 'UPI and cash' },
            { value: 'upi', label: 'UPI' },
            { value: 'cash', label: 'Cash' },
          ]}
        />
        <SelectField
          label="Payment status"
          value={filter.paymentStatus}
          onChange={set('paymentStatus')}
          options={[
            { value: '', label: 'Any' },
            { value: 'paid', label: 'UPI paid' },
            { value: 'due', label: 'Cash due' },
            { value: 'paid_cash', label: 'Cash paid' },
            { value: 'refund_pending', label: 'Refund pending' },
            { value: 'refunded', label: 'Refunded' },
            { value: 'pending', label: 'Not paid yet' },
            { value: 'failed', label: 'Payment failed' },
          ]}
        />
        <TextField
          label="From"
          type="date"
          value={filter.from}
          onChange={(e) => set('from')(e.target.value)}
        />
        <TextField label="To" type="date" value={filter.to} onChange={(e) => set('to')(e.target.value)} />
      </div>
      {filtered && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setFilter(EMPTY)}>
          Clear filters
        </Button>
      )}

      {orders.isPending ? (
        <Skeleton className="h-64" />
      ) : orders.isError ? (
        <EmptyState
          title="Can't load orders"
          description="Check the filters and your internet connection, then try again."
          action={<Button onClick={() => orders.refetch()}>Try again</Button>}
        />
      ) : (
        <>
          <DataTable<AdminOrderRow>
            caption="Orders"
            rows={rows}
            rowKey={(o) => o.id}
            empty={filtered ? 'No orders match.' : 'No orders yet.'}
            columns={[
              {
                key: 'when',
                header: 'When',
                cell: (o) => (
                  <Link
                    href={`/admin/orders/${o.id}`}
                    className="font-semibold whitespace-nowrap text-brand underline-offset-2 hover:underline dark:text-ink"
                  >
                    {formatDateTime(new Date(o.createdAt))}
                  </Link>
                ),
              },
              { key: 'stall', header: 'Stall', cell: (o) => o.stall.name },
              {
                key: 'token',
                header: 'Token',
                cell: (o) => <span className="tabular">{o.tokenNo ? `#${o.tokenNo}` : '—'}</span>,
              },
              {
                key: 'student',
                header: 'Student',
                cell: (o) => (
                  <span>
                    {o.student.name ?? 'No name'}
                    <span className="tabular block text-xs text-ink-muted">{o.student.phone}</span>
                  </span>
                ),
              },
              { key: 'status', header: 'Status', cell: (o) => <OrderStatusChip status={o.status} /> },
              {
                key: 'payment',
                header: 'Payment',
                cell: (o) => <PaymentStatusChip status={o.paymentStatus} />,
              },
              {
                key: 'total',
                header: 'Total',
                align: 'right',
                cell: (o) => <span className="tabular">{formatINR(o.totalPaise)}</span>,
              },
            ]}
          />
          {orders.hasNextPage && (
            <Button
              variant="secondary"
              className="self-center"
              loading={orders.isFetchingNextPage}
              onClick={() => orders.fetchNextPage()}
            >
              Show more
            </Button>
          )}
        </>
      )}
    </div>
  );
}
