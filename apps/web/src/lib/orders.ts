'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import { cartStore } from './cart';

export interface Order {
  id: string;
  stall: { id: string; slug: string; name: string; location: string | null };
  status:
    'pending_payment' | 'placed' | 'preparing' | 'ready' | 'collected' | 'rejected' | 'cancelled' | 'expired';
  paymentMethod: 'upi' | 'cash';
  paymentStatus: 'pending' | 'paid' | 'due' | 'paid_cash' | 'refund_pending' | 'refunded' | 'failed';
  tokenNo: number | null;
  tokenDay: string | null;
  pickupCode: string;
  /** Signed QR to show at the counter while waiting to collect; null otherwise. */
  pickupQr: string | null;
  note: string | null;
  rejectReason: string | null;
  items: Array<{
    itemId: string;
    name: string;
    quantity: number;
    unitPricePaise: number;
    lineTotalPaise: number;
  }>;
  subtotalPaise: number;
  platformFeePaise: number;
  cashFeePaise: number;
  totalPaise: number;
  platformFeeBps: number;
  cashFeeBps: number;
  createdAt: string;
  expiresAt: string | null;
}

export const STATUS_LABEL: Record<Order['status'], string> = {
  pending_payment: 'Waiting for payment',
  placed: 'Waiting for the stall to accept',
  preparing: 'Being prepared',
  ready: 'Ready — show your token',
  collected: 'Collected',
  rejected: 'Rejected by the stall',
  cancelled: 'Cancelled',
  expired: 'Payment not completed',
};

export function useOrder(id: string) {
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => apiRequest<{ order: Order }>(`/v1/orders/${encodeURIComponent(id)}`),
    select: (d) => d.order,
    // Live updates (useOrderEvents) refresh this instantly; polling is only a slow safety net.
    refetchInterval: 60_000,
  });
}

/** A row in "My orders". */
export interface OrderSummary {
  id: string;
  stall: { slug: string; name: string };
  status: Order['status'];
  paymentMethod: Order['paymentMethod'];
  paymentStatus: Order['paymentStatus'];
  tokenNo: number | null;
  totalPaise: number;
  itemCount: number;
  itemsPreview: string;
  createdAt: string;
}

interface OrderList {
  orders: OrderSummary[];
  nextBefore: string | null;
}

export const ORDERS_KEY = ['orders'] as const;

/** Orders still in progress (waiting for payment, placed, preparing, ready). */
export function useActiveOrders(enabled = true) {
  return useQuery({
    queryKey: [...ORDERS_KEY, 'active'],
    queryFn: () => apiRequest<OrderList>('/v1/orders?scope=active'),
    select: (d) => d.orders,
    refetchInterval: 60_000,
    enabled,
  });
}

/** Finished orders, newest first, 20 per page. */
export function usePastOrders(enabled = true) {
  return useInfiniteQuery({
    queryKey: [...ORDERS_KEY, 'past'],
    queryFn: ({ pageParam }) =>
      apiRequest<OrderList>(
        `/v1/orders?scope=past&limit=20${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
    enabled,
  });
}

/** Statuses the student may still cancel (before the stall starts cooking). */
export function canCancel(status: Order['status']): boolean {
  return status === 'pending_payment' || status === 'placed';
}

export function useCancelOrder(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<{ order: Order }>(`/v1/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
    onSuccess: (data) => {
      queryClient.setQueryData(['order', id], data);
      void queryClient.invalidateQueries({ queryKey: ORDERS_KEY });
    },
  });
}

/**
 * "Order again": puts a past order's dishes back in the cart (replacing whatever was there).
 * Prices are the old ones until the cart page re-checks them with the server, which also
 * flags anything sold out or removed — so nothing is charged at a stale price.
 */
export async function reorder(id: string): Promise<{ replacedOtherStall: boolean }> {
  const { order } = await apiRequest<{ order: Order }>(`/v1/orders/${encodeURIComponent(id)}`);
  const before = cartStore.get();
  const replacedOtherStall = before.lines.length > 0 && before.stall?.id !== order.stall.id;
  cartStore.fill(
    { id: order.stall.id, slug: order.stall.slug, name: order.stall.name },
    order.items.map((i) => ({
      itemId: i.itemId,
      name: i.name,
      pricePaise: i.unitPricePaise,
      quantity: i.quantity,
    })),
  );
  return { replacedOtherStall };
}

/** One key per checkout attempt: a retried "Place order" never creates a second order. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
