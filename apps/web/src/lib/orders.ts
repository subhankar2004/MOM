'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api-client';

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
    refetchInterval: 15_000, // live updates arrive with #17
  });
}

/** One key per checkout attempt: a retried "Place order" never creates a second order. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
