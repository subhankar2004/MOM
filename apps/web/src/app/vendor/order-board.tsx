'use client';

import { ClipboardList, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip } from '@/components/ui/status-chip';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { OrderCard } from '@/components/vendor/order-card';
import { RejectSheet } from '@/components/vendor/reject-sheet';
import { ApiError } from '@/lib/api-client';
import { audioUnlocked, playTones, unlockAudio } from '@/lib/chime';
import { formatTime } from '@/lib/time';
import { useNow } from '@/lib/use-now';
import { useCurrentStall } from '@/lib/vendor-stall';
import { useBoardAction, useStallBoard, useStallOrderEvents, type BoardOrder } from '@/lib/vendor-orders';

type Column = 'placed' | 'preparing' | 'ready';
const COLUMNS: Array<{ key: Column; title: string; empty: string }> = [
  { key: 'placed', title: 'New', empty: 'New orders appear here.' },
  { key: 'preparing', title: 'Preparing', empty: 'Accepted orders appear here.' },
  { key: 'ready', title: 'Ready', empty: 'Orders waiting for pickup appear here.' },
];

const FINISHED_LABEL: Partial<Record<BoardOrder['status'], string>> = {
  collected: 'Collected',
  rejected: 'Rejected',
  cancelled: 'Cancelled by student',
};

/** The counter board (spec §6.2 V1): New → Preparing → Ready, live, with a chime for new orders. */
export function OrderBoard() {
  const { current: stall } = useCurrentStall();
  const board = useStallBoard(stall.id);
  const action = useBoardAction(stall.id);
  const toast = useToast();
  const now = useNow();
  const [tab, setTab] = useState<Column>('placed');
  const [rejecting, setRejecting] = useState<BoardOrder | null>(null);
  // Already unlocked earlier in this visit (moving between console pages keeps it on).
  const [soundOn, setSoundOn] = useState(audioUnlocked);

  // Chime once per new order (not for orders already on the board when the page opened).
  const known = useRef(new Set<string>());
  useEffect(() => {
    board.data?.active.forEach((o) => known.current.add(o.id));
  }, [board.data]);
  useStallOrderEvents(stall.id, (event) => {
    if (event.status !== 'placed' || known.current.has(event.orderId)) return;
    known.current.add(event.orderId);
    playTones([660, 880, 1100], 0.16);
    try {
      navigator.vibrate?.(300);
    } catch {
      /* not supported */
    }
  });

  const active = board.data?.active ?? [];
  const byColumn = (c: Column) => active.filter((o) => o.status === c);
  const newCount = byColumn('placed').length;

  // "(3) Orders · Stall console" in the tab strip while orders wait to be accepted.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, '');
    document.title = newCount ? `(${newCount}) ${base}` : base;
    return () => {
      document.title = document.title.replace(/^\(\d+\) /, '');
    };
  }, [newCount]);

  function run(orderId: string, kind: 'accept' | 'ready' | 'reject', reason?: string) {
    action.mutate(
      { orderId, action: kind, reason },
      {
        onSuccess: ({ order, refund }) => {
          setRejecting(null);
          if (kind === 'reject') {
            toast(
              refund === 'started'
                ? `Token #${order.tokenNo} rejected. Refund started.`
                : refund === 'retry_later'
                  ? `Token #${order.tokenNo} rejected. The refund will be retried by MOM.`
                  : `Token #${order.tokenNo} rejected.`,
              'success',
            );
          }
        },
        onError: (err) => {
          setRejecting(null);
          toast(err instanceof ApiError ? err.message : 'That didn’t go through. Try again.', 'error');
        },
      },
    );
  }

  const busyId = action.isPending ? action.variables?.orderId : undefined;
  const column = (c: (typeof COLUMNS)[number]) => {
    const list = byColumn(c.key);
    return list.length === 0 ? (
      <p className="rounded-(--radius-card) border border-dashed border-border px-4 py-8 text-center text-sm text-ink-muted">
        {c.empty}
      </p>
    ) : (
      <ul className="flex flex-col gap-3">
        {list.map((o) => (
          <li key={o.id}>
            <OrderCard
              order={o}
              now={now}
              busy={busyId === o.id}
              onAction={(kind) => run(o.id, kind)}
              onReject={() => setRejecting(o)}
            />
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-3xl font-bold">Today&apos;s orders</h1>
        <Button
          variant={soundOn ? 'ghost' : 'haldi'}
          icon={soundOn ? <Volume2 size={18} aria-hidden /> : <VolumeX size={18} aria-hidden />}
          aria-pressed={soundOn}
          onClick={async () => {
            const ok = await unlockAudio();
            setSoundOn(ok);
            if (ok) playTones([660, 880, 1100], 0.16);
            else toast('This browser won’t play sounds. Keep an eye on the board.', 'error');
          }}
        >
          {soundOn ? 'Sound on' : 'Turn on order sound'}
        </Button>
      </div>

      {board.isPending ? (
        <div className="grid gap-4 md:grid-cols-3" aria-busy="true" aria-label="Loading orders">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : board.isError ? (
        <EmptyState
          title="Couldn’t load orders"
          description="Check the internet connection. The board retries by itself."
          action={<Button onClick={() => void board.refetch()}>Try again</Button>}
        />
      ) : active.length === 0 && board.data.finishedToday.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={36} aria-hidden />}
          title="No orders yet today"
          description="New orders appear here by themselves. Turn on the order sound to hear them."
        />
      ) : (
        <>
          {/* Tablets and laptops: three columns side by side. */}
          <div className="hidden gap-4 md:grid md:grid-cols-3">
            {COLUMNS.map((c) => (
              <section key={c.key} aria-labelledby={`col-${c.key}`} className="flex flex-col gap-3">
                <h2 id={`col-${c.key}`} className="flex items-center gap-2 font-display text-xl font-bold">
                  {c.title}
                  <span className="tabular rounded-full bg-surface-2 px-2 text-base">
                    {byColumn(c.key).length}
                  </span>
                </h2>
                {column(c)}
              </section>
            ))}
          </div>
          {/* Phones: one column at a time. */}
          <div className="md:hidden">
            <Tabs
              label="Order status"
              value={tab}
              onChange={setTab}
              items={COLUMNS.map((c) => ({ key: c.key, label: `${c.title} (${byColumn(c.key).length})` }))}
            >
              {column(COLUMNS.find((c) => c.key === tab)!)}
            </Tabs>
          </div>

          {board.data.finishedToday.length > 0 && (
            <details className="rounded-(--radius-card) border border-border bg-surface">
              <summary className="cursor-pointer px-4 py-3 font-semibold">
                Finished today ({board.data.finishedToday.length})
              </summary>
              <ul className="divide-y divide-border border-t border-border">
                {board.data.finishedToday.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                    <span className="tabular w-12 font-bold">#{o.tokenNo}</span>
                    <StatusChip tone={o.status === 'collected' ? 'success' : 'neutral'}>
                      {FINISHED_LABEL[o.status] ?? o.status}
                    </StatusChip>
                    <span className="min-w-0 flex-1 truncate text-ink-muted">
                      {o.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}
                      {o.rejectReason ? ` — “${o.rejectReason}”` : ''}
                    </span>
                    {o.closedAt && <span className="text-ink-muted">{formatTime(new Date(o.closedAt))}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <RejectSheet
        key={rejecting?.id ?? 'none'}
        order={rejecting}
        pending={action.isPending && action.variables?.action === 'reject'}
        onClose={() => setRejecting(null)}
        onConfirm={(reason) => rejecting && run(rejecting.id, 'reject', reason)}
      />
    </div>
  );
}
