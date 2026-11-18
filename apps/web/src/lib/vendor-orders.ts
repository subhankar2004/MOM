'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import { useEventStream } from './event-stream';
import type { Order } from './orders';

/** An order on the stall's board (no student details). */
export interface BoardOrder {
  id: string;
  tokenNo: number;
  status: Order['status'];
  paymentMethod: Order['paymentMethod'];
  paymentStatus: Order['paymentStatus'];
  totalPaise: number;
  note: string | null;
  rejectReason: string | null;
  items: Array<{ name: string; quantity: number }>;
  placedAt: string | null;
  acceptedAt: string | null;
  readyAt: string | null;
  closedAt: string | null;
}

export interface Board {
  active: BoardOrder[];
  finishedToday: BoardOrder[];
}

export interface StallOrderEvent {
  id: string;
  orderId: string;
  status: Order['status'];
  paymentStatus: Order['paymentStatus'];
  tokenNo: number | null;
}

export type BoardAction = 'accept' | 'ready' | 'reject';

const boardKey = (stallId: string) => ['vendor', 'board', stallId] as const;

export function useStallBoard(stallId: string) {
  return useQuery({
    queryKey: boardKey(stallId),
    queryFn: () => apiRequest<Board>(`/v1/vendor/stalls/${encodeURIComponent(stallId)}/orders`),
    // Live events refresh the board at once; this is only a safety net.
    refetchInterval: 60_000,
  });
}

/** Keeps the board live; `onEvent` sees each change (used for the new-order chime). */
export function useStallOrderEvents(stallId: string, onEvent?: (event: StallOrderEvent) => void) {
  const queryClient = useQueryClient();
  const refetch = () => void queryClient.invalidateQueries({ queryKey: boardKey(stallId) });
  useEventStream<StallOrderEvent>(`/v1/vendor/stalls/${encodeURIComponent(stallId)}/orders/events`, {
    onEvent: (event) => {
      refetch();
      onEvent?.(event);
    },
    onResync: refetch,
  });
}

/** Accept / mark ready / reject. The board updates immediately with the server's answer. */
export function useBoardAction(stallId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { orderId: string; action: BoardAction; reason?: string }) =>
      apiRequest<{ order: BoardOrder; refund: 'started' | 'retry_later' | 'none' }>(
        `/v1/vendor/stalls/${encodeURIComponent(stallId)}/orders/${encodeURIComponent(input.orderId)}/${input.action}`,
        { method: 'POST', body: input.action === 'reject' ? { reason: input.reason } : undefined },
      ),
    onSuccess: ({ order }) => {
      queryClient.setQueryData<Board>(boardKey(stallId), (board) => {
        if (!board) return board;
        const onBoard = ['placed', 'preparing', 'ready'].includes(order.status);
        const active = board.active.filter((o) => o.id !== order.id);
        return {
          active: onBoard ? board.active.map((o) => (o.id === order.id ? order : o)) : active,
          finishedToday: onBoard
            ? board.finishedToday
            : [order, ...board.finishedToday.filter((o) => o.id !== order.id)],
        };
      });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: boardKey(stallId) }),
  });
}
