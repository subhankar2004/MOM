import { isApiErrorBody, type ApiErrorCode } from '@mom/shared';

/** Base URL of the MOM API (NEXT_PUBLIC_API_URL, inlined at build time). */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/** An error from the API, in the spec §9 shape — or a network/timeout problem. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode | 'NETWORK_ERROR' | 'TIMEOUT',
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** 4xx errors are the caller's problem: retrying will not help. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Sent as Idempotency-Key, e.g. for placing an order (#14). */
  idempotencyKey?: string;
  timeoutMs?: number;
}

/**
 * One fetch to the MOM API: JSON in/out, cookies included (auth, #7), timeout, and every
 * failure turned into an ApiError with a readable message. No session renewal (see apiRequest).
 */
async function rawRequest<T>(path: `/${string}`, options: RequestOptions = {}): Promise<T> {
  const { body, idempotencyKey, timeoutMs = 15_000, headers, signal, ...init } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (timeout.aborted) throw new ApiError(0, 'TIMEOUT', 'The server took too long to answer. Try again.');
    if (signal?.aborted) throw err; // cancelled by the caller (e.g. React Query)
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach MOM. Check your internet connection.');
  }

  const requestId = response.headers.get('x-request-id') ?? undefined;
  const text = await response.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!response.ok) {
    if (isApiErrorBody(data)) {
      throw new ApiError(response.status, data.error.code, data.error.message, data.error.details, requestId);
    }
    throw new ApiError(
      response.status,
      'INTERNAL_ERROR',
      `Unexpected response (${response.status})`,
      undefined,
      requestId,
    );
  }
  return data as T;
}

// --- Sessions ---------------------------------------------------------------------------

type SessionListener = () => void;
const sessionExpiredListeners = new Set<SessionListener>();

/** Called when the session can't be renewed (signed out elsewhere, expired, suspended). */
export function onSessionExpired(listener: SessionListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Renews the 15-minute access cookie using the refresh cookie. Parallel callers share one
 * request, so ten requests failing at once cause one refresh, not ten.
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= rawRequest('/v1/auth/refresh', { method: 'POST' })
    .then(() => true)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/**
 * Typed request to the MOM API. If the access token has expired (401), the session is
 * renewed silently and the request retried once; if that fails, listeners are told the
 * session ended and the original error is thrown.
 */
export async function apiRequest<T>(path: `/${string}`, options: RequestOptions = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, options);
  } catch (err) {
    const isAuthRoute = path.startsWith('/v1/auth/');
    if (!(err instanceof ApiError) || err.status !== 401 || isAuthRoute) throw err;
    if (!(await refreshSession())) {
      sessionExpiredListeners.forEach((listener) => listener());
      throw err;
    }
    return rawRequest<T>(path, options);
  }
}
