'use client';

import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { onSessionExpired } from '@/lib/api-client';
import { makeQueryClient } from '@/lib/query-client';
import { ME_QUERY_KEY, setSessionHint } from '@/lib/session';

function SessionWatcher({ client }: { client: QueryClient }) {
  // If the session can't be renewed, every screen sees "signed out" at once.
  useEffect(
    () =>
      onSessionExpired(() => {
        setSessionHint(false);
        client.setQueryData(ME_QUERY_KEY, null);
      }),
    [client],
  );
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  // One QueryClient per browser session (not shared between server requests).
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <SessionWatcher client={queryClient} />
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
