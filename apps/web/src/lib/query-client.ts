import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-client';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Retry network hiccups and 5xx twice; never retry 4xx (it would fail the same way).
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.isClientError) && failureCount < 2,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}
