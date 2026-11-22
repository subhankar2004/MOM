'use client';

import type { MeResponse } from '@mom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest } from './api-client';

export type SessionUser = MeResponse['user'];
export const ME_QUERY_KEY = ['me'] as const;

/**
 * "This browser has signed in" hint. The session cookies are httpOnly (invisible to
 * JavaScript), so without it every anonymous page view would call /v1/me and then
 * /v1/auth/refresh just to learn "signed out" — two wasted requests that also count
 * toward per-IP rate limits shared by everyone on campus Wi-Fi. Holds no secret.
 */
const SESSION_HINT_KEY = 'mom.session';

export function setSessionHint(signedIn: boolean): void {
  try {
    if (signedIn) localStorage.setItem(SESSION_HINT_KEY, '1');
    else localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // storage blocked: we simply always ask the server
  }
}

function hasSessionHint(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) !== null;
  } catch {
    return true; // can't tell — ask the server
  }
}

/** The signed-in user, or null when signed out. 401 is an answer here, not an error. */
async function fetchMe(): Promise<SessionUser | null> {
  if (!hasSessionHint()) return null;
  try {
    return (await apiRequest<MeResponse>('/v1/me')).user;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      setSessionHint(false);
      return null;
    }
    throw err;
  }
}

export function useSession() {
  const query = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, staleTime: 5 * 60_000 });
  const user = query.data ?? null;
  return {
    user,
    status: query.isPending
      ? ('loading' as const)
      : query.isError
        ? ('error' as const)
        : user
          ? ('signed-in' as const)
          : ('signed-out' as const),
    error: query.error,
    retry: query.refetch,
  };
}

/** Remember the user returned by login/refresh so pages don't refetch it. */
export function useSetSessionUser() {
  const queryClient = useQueryClient();
  return (user: SessionUser | null) => {
    setSessionHint(user !== null);
    queryClient.setQueryData(ME_QUERY_KEY, user);
  };
}

/**
 * Signs out on the server, then loads `redirectTo` as a fresh page. A full page load
 * (rather than client navigation) guarantees nothing from this user stays in memory,
 * and avoids guards racing to redirect to /login while the session is cleared.
 */
export function useSignOut(redirectTo: '/' | '/login' | '/vendor/login' | '/admin/login' = '/') {
  return useMutation({
    mutationFn: () => apiRequest<null>('/v1/auth/logout', { method: 'POST' }),
    // Signed out locally even if the network call failed (cookies are httpOnly; the server
    // clears them on success, and an unreachable server can't use them either).
    onSettled: () => {
      setSessionHint(false);
      window.location.assign(redirectTo);
    },
  });
}
