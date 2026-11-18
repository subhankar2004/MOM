'use client';

import { useEffect, useRef } from 'react';
import { API_URL, refreshSession } from './api-client';

const MAX_BACKOFF_MS = 30_000;

export interface EventStreamHandlers<E> {
  /** A change arrived (`event: order`). */
  onEvent: (event: E) => void;
  /** We may have missed changes (reconnected, or the server lost our place): refetch. */
  onResync: () => void;
}

/**
 * One Server-Sent Events connection to the MOM API (`path`, or none when null).
 *
 * Recovery: the browser reconnects by itself after a drop (resuming with Last-Event-ID).
 * If the server refuses the stream (e.g. the 15-minute access cookie expired) the session is
 * renewed and we reconnect with backoff; when coming back online or to the tab, at once.
 * After any reconnect `onResync` runs, so nothing missed while offline stays stale.
 */
export function useEventStream<E>(path: `/${string}` | null, handlers: EventStreamHandlers<E>) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!path || typeof EventSource === 'undefined') return;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let connectedBefore = false;
    let stopped = false;

    const connect = () => {
      clearTimeout(timer);
      source?.close();
      const es = new EventSource(`${API_URL}${path}`, { withCredentials: true });
      source = es;
      es.addEventListener('ready', () => {
        attempt = 0;
        if (connectedBefore) ref.current.onResync();
        connectedBefore = true;
      });
      es.addEventListener('resync', () => {
        attempt = 0;
        connectedBefore = true;
        ref.current.onResync();
      });
      es.addEventListener('order', (msg) => {
        try {
          ref.current.onEvent(JSON.parse((msg as MessageEvent<string>).data) as E);
        } catch {
          // malformed event: ignore
        }
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
  }, [path]);
}
