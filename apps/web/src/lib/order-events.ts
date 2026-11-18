'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEventStream } from './event-stream';
import { ORDERS_KEY, type Order } from './orders';

/** What the API sends when one of my orders changes (GET /v1/orders/events). */
export interface OrderEvent {
  id: string;
  orderId: string;
  status: Order['status'];
  paymentStatus: Order['paymentStatus'];
  tokenNo: number | null;
  at: string;
}

/**
 * Keeps the student's orders live (spec §7.1): one stream for all their orders. Each change
 * refetches the affected order and the lists, so screens update within a second or two of
 * the stall tapping a button.
 */
export function useOrderEvents(enabled: boolean, onEvent?: (event: OrderEvent) => void) {
  const queryClient = useQueryClient();
  useEventStream<OrderEvent>(enabled ? '/v1/orders/events' : null, {
    onEvent: (event) => {
      void queryClient.invalidateQueries({ queryKey: ['order', event.orderId] });
      void queryClient.invalidateQueries({ queryKey: ORDERS_KEY });
      onEvent?.(event);
    },
    onResync: () => {
      void queryClient.invalidateQueries({ queryKey: ORDERS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['order'] });
    },
  });
}
