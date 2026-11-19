'use client';

import { formatINR } from '@mom/shared';
import { ChevronRight, ReceiptText, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { SHORT_STATUS, STATUS_TONE as TONE } from '@/components/order/order-status-chip';
import { StatusChip } from '@/components/ui/status-chip';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { reorder, useActiveOrders, usePastOrders, type OrderSummary } from '@/lib/orders';
import { orderDateLabel } from '@/lib/time';

type Tab = 'active' | 'past';

const REFUND_NOTE: Partial<Record<OrderSummary['paymentStatus'], string>> = {
  refund_pending: 'Refund on its way',
  refunded: 'Refunded',
};

/** My orders (spec §6.1 S7): what's cooking now, live, and everything before. */
export function OrdersView() {
  const [tab, setTab] = useState<Tab>('active');
  const active = useActiveOrders();
  const activeCount = active.data?.length ?? 0;
  return (
    <div>
      <h1 className="mb-3 font-display text-3xl font-bold">Your orders</h1>
      <Tabs
        label="Orders"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'active', label: activeCount ? `Active (${activeCount})` : 'Active' },
          { key: 'past', label: 'Past' },
        ]}
      >
        {tab === 'active' ? <ActiveList query={active} onShowPast={() => setTab('past')} /> : <PastList />}
      </Tabs>
    </div>
  );
}

function ActiveList({
  query,
  onShowPast,
}: {
  query: ReturnType<typeof useActiveOrders>;
  onShowPast: () => void;
}) {
  if (query.isPending) return <ListSkeleton />;
  if (query.isError) return <LoadError retry={() => void query.refetch()} />;
  if (query.data.length === 0) {
    return (
      <EmptyState
        icon={<ReceiptText size={36} aria-hidden />}
        title="Nothing cooking right now"
        description="Orders you place show up here, and update live as the stall prepares them."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <ButtonLink href="/">Find food</ButtonLink>
            <Button variant="secondary" onClick={onShowPast}>
              See past orders
            </Button>
          </div>
        }
      />
    );
  }
  return (
    <ul className="flex flex-col gap-3" aria-live="polite">
      {query.data.map((o) => (
        <li key={o.id}>
          <ActiveRow order={o} />
        </li>
      ))}
    </ul>
  );
}

function ActiveRow({ order: o }: { order: OrderSummary }) {
  const ready = o.status === 'ready';
  return (
    <Link
      href={`/orders/${o.id}`}
      className={
        'flex items-center gap-4 rounded-(--radius-card) border p-4 transition-colors ' +
        (ready ? 'border-success bg-success-soft' : 'border-border bg-surface hover:bg-surface-2')
      }
    >
      <div
        className={
          'flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-(--radius-control) ' +
          (ready ? 'bg-success text-white dark:text-[#06210f]' : 'bg-haldi text-haldi-ink')
        }
      >
        {o.tokenNo ? (
          <>
            <span className="text-[0.65rem] font-semibold">Token</span>
            <span className="tabular font-display text-2xl leading-none font-black">#{o.tokenNo}</span>
          </>
        ) : (
          <span className="px-1 text-center text-xs font-semibold">Pay to get token</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{o.stall.name}</p>
        <p className="truncate text-sm text-ink-muted">{o.itemsPreview}</p>
        <div className="mt-1 flex items-center gap-2">
          <StatusChip tone={TONE[o.status]}>{SHORT_STATUS[o.status]}</StatusChip>
          <span className="tabular text-sm">{formatINR(o.totalPaise)}</span>
        </div>
      </div>
      <ChevronRight size={20} aria-hidden className="shrink-0 text-ink-muted" />
    </Link>
  );
}

function PastList() {
  const query = usePastOrders();
  const router = useRouter();
  const toast = useToast();
  const [reordering, setReordering] = useState<string | null>(null);

  if (query.isPending) return <ListSkeleton />;
  if (query.isError) return <LoadError retry={() => void query.refetch()} />;
  const orders = query.data.pages.flatMap((p) => p.orders);
  if (orders.length === 0) {
    return (
      <EmptyState
        icon={<ReceiptText size={36} aria-hidden />}
        title="No past orders yet"
        description="Once you’ve collected an order, you can order it again from here in one tap."
        action={<ButtonLink href="/">Find food</ButtonLink>}
      />
    );
  }

  async function orderAgain(id: string) {
    setReordering(id);
    try {
      const { replacedOtherStall } = await reorder(id);
      if (replacedOtherStall) toast('Your previous cart was replaced.', 'info');
      router.push('/cart');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not load that order. Try again.', 'error');
      setReordering(null);
    }
  }

  const now = new Date();
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {orders.map((o) => (
          <li key={o.id}>
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/orders/${o.id}`} className="min-w-0 flex-1 hover:underline">
                  <p className="truncate font-semibold">{o.stall.name}</p>
                  <p className="text-sm text-ink-muted">{orderDateLabel(new Date(o.createdAt), now)}</p>
                </Link>
                <span className="tabular font-semibold">{formatINR(o.totalPaise)}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm">{o.itemsPreview}</p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  <StatusChip tone={TONE[o.status]}>{SHORT_STATUS[o.status]}</StatusChip>
                  {REFUND_NOTE[o.paymentStatus] && (
                    <StatusChip tone="neutral">{REFUND_NOTE[o.paymentStatus]}</StatusChip>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RotateCcw size={16} aria-hidden />}
                  loading={reordering === o.id}
                  disabled={reordering !== null}
                  onClick={() => void orderAgain(o.id)}
                  aria-label={`Order again from ${o.stall.name}: ${o.itemsPreview}`}
                >
                  Order again
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {query.hasNextPage && (
        <Button
          variant="secondary"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Show older orders
        </Button>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading orders">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

function LoadError({ retry }: { retry: () => void }) {
  return (
    <EmptyState
      title="Couldn’t load your orders"
      description="Check your connection and try again."
      action={<Button onClick={retry}>Try again</Button>}
    />
  );
}
