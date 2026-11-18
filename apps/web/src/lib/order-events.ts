'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { API_URL, refreshSession } from './api-client';
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

const MAX_BACKOFF_MS = 30_000;

/**
 * Keeps the student's orders live (spec §7.1): one Server-Sent Events connection for all
 * their orders. Each change refetches the affected order and the lists, so screens update
 * within a second or two of the stall tapping a button.
 *
 * Recovery: the browser reconnects by itself after a drop (resuming with Last-Event-ID).
 * If the server refuses the stream (e.g. the 15-minute access cookie expired) we renew the
 * session and reconnect with backoff; when coming back online or to the tab, at once. After
 * any reconnect everything is refetched, so nothing missed while offline stays stale.
 */
export function useOrderEvents(enabled: boolean, onEvent?: (event: OrderEvent) => void) {
  const queryClient = useQueryClient();
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let connectedBefore = false;
    let stopped = false;

    const refetchAll = () => {
      void queryClient.invalidateQueries({ queryKey: ORDERS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['order'] });
    };

    const connect = () => {
      clearTimeout(timer);
      source?.close();
      const es = new EventSource(`${API_URL}/v1/orders/events`, { withCredentials: true });
      source = es;
      const onOpen = () => {
        attempt = 0;
        if (connectedBefore) refetchAll(); // we may have missed changes while disconnected
        connectedBefore = true;
      };
      es.addEventListener('ready', onOpen);
      es.addEventListener('resync', () => {
        attempt = 0;
        connectedBefore = true;
        refetchAll();
      });
      es.addEventListener('order', (msg) => {
        let event: OrderEvent;
        try {
          event = JSON.parse((msg as MessageEvent<string>).data) as OrderEvent;
        } catch {
          return;
        }
        void queryClient.invalidateQueries({ queryKey: ['order', event.orderId] });
        void queryClient.invalidateQueries({ queryKey: ORDERS_KEY });
        onEventRef.current?.(event);
      });
      es.onerror = () => {
        // CONNECTING: the browser is already retrying. CLOSED: it gave up (401, server error).
        if (es.readyState !== EventSource.CLOSED || stopped) return;
        es.close();
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++);
        timer = setTimeout(() => {
          void refreshSession().finally(() => {
            if (!stopped) connect();
          });
        }, delay);
      };
    };

    const reconnectIfClosed = () => {
      if (stopped || document.visibilityState === 'hidden') return;
      if (!source || source.readyState === EventSource.CLOSED) {
        attempt = 0;
        connect();
      }
    };

    connect();
    window.addEventListener('online', reconnectIfClosed);
    document.addEventListener('visibilitychange', reconnectIfClosed);
    return () => {
      stopped = true;
      clearTimeout(timer);
      source?.close();
      window.removeEventListener('online', reconnectIfClosed);
      document.removeEventListener('visibilitychange', reconnectIfClosed);
    };
  }, [enabled, queryClient]);
}
