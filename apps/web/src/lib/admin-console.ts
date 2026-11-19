'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import type { Order } from './orders';

// ── Users & access (spec §6.3 A4) ────────────────────────────────────────

export type UserRole = 'student' | 'vendor_owner' | 'vendor_staff' | 'super_admin';
export type UserStatus = 'active' | 'suspended';

export const ROLE_LABEL: Record<UserRole, string> = {
  student: 'Student',
  vendor_owner: 'Stall owner',
  vendor_staff: 'Counter staff',
  super_admin: 'Super admin',
};

export interface AdminUserRow {
  id: string;
  name: string | null;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  cashStrikes: number;
  createdAt: string;
  orders: number;
}

export interface AdminUserDetail {
  user: Omit<AdminUserRow, 'orders'>;
  memberships: Array<{ stallId: string; stallName: string; role: 'owner' | 'staff' }>;
  recentOrders: Array<{
    id: string;
    stallName: string;
    tokenNo: number | null;
    status: Order['status'];
    paymentMethod: Order['paymentMethod'];
    paymentStatus: Order['paymentStatus'];
    totalPaise: number;
    createdAt: string;
  }>;
  activeSessions: number;
  superAdminFromSettings: boolean;
}

/** Turns filter values into a query string, leaving out empty ones. */
export function queryString(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v?.trim()) q.set(k, v.trim());
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function useAdminUsers(filter: { q: string; role: UserRole | ''; status: UserStatus | '' }) {
  return useInfiniteQuery({
    queryKey: ['admin', 'users', filter],
    queryFn: ({ pageParam }) =>
      apiRequest<{ users: AdminUserRow[]; nextBefore: string | null }>(
        `/v1/admin/users${queryString({ q: filter.q, role: filter.role, status: filter.status, before: pageParam })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    placeholderData: (previous) => previous,
  });
}

const userKey = (id: string) => ['admin', 'user', id] as const;

export function useAdminUser(id: string) {
  return useQuery({
    queryKey: userKey(id),
    queryFn: () => apiRequest<AdminUserDetail>(`/v1/admin/users/${encodeURIComponent(id)}`),
  });
}

/** Any user action; refreshes the user and the lists. */
export function useUserAction<T>(id: string, run: (input: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: userKey(id) });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

const userPath = (id: string) => `/v1/admin/users/${encodeURIComponent(id)}` as const;

export const userActions = {
  suspend: (id: string, suspended: boolean) =>
    apiRequest(`${userPath(id)}/suspension`, { method: 'POST', body: { suspended } }),
  signOut: (id: string) => apiRequest(`${userPath(id)}/sign-out`, { method: 'POST' }),
  resetStrikes: (id: string) => apiRequest(`${userPath(id)}/cash-strikes/reset`, { method: 'POST' }),
  superAdmin: (id: string, grant: boolean, confirmLast4: string) =>
    apiRequest(`${userPath(id)}/super-admin`, { method: 'POST', body: { grant, confirmLast4 } }),
};

// ── Orders explorer (spec §6.3 A5) ───────────────────────────────────────

export interface AdminOrderRow {
  id: string;
  createdAt: string;
  stall: { id: string; name: string };
  student: { id: string; name: string | null; phone: string | null };
  tokenNo: number | null;
  status: Order['status'];
  paymentMethod: Order['paymentMethod'];
  paymentStatus: Order['paymentStatus'];
  totalPaise: number;
}

export interface AdminOrderDetail {
  order: {
    id: string;
    status: Order['status'];
    paymentMethod: Order['paymentMethod'];
    paymentStatus: Order['paymentStatus'];
    tokenNo: number | null;
    tokenDay: string | null;
    note: string | null;
    reason: string | null;
    subtotalPaise: number;
    platformFeePaise: number;
    cashFeePaise: number;
    totalPaise: number;
    createdAt: string;
  };
  stall: { id: string; name: string; slug: string };
  student: { id: string; name: string | null; phone: string | null };
  items: Array<{ name: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }>;
  payments: Array<{
    id: string;
    providerPaymentId: string | null;
    amountPaise: number;
    status: string;
    createdAt: string;
  }>;
  refunds: Array<{ id: string; amountPaise: number; status: string; reason: string; createdAt: string }>;
  timeline: Array<{ at: string; label: string; by: string | null }>;
  can: { cancel: boolean; refund: boolean };
}

export interface OrderFilter {
  q: string;
  stallId: string;
  status: Order['status'] | '';
  paymentMethod: Order['paymentMethod'] | '';
  paymentStatus: Order['paymentStatus'] | '';
  from: string;
  to: string;
}

export function useAdminOrders(filter: OrderFilter) {
  return useInfiniteQuery({
    queryKey: ['admin', 'orders', filter],
    queryFn: ({ pageParam }) =>
      apiRequest<{ orders: AdminOrderRow[]; nextBefore: string | null }>(
        `/v1/admin/orders${queryString({ ...filter, before: pageParam })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    placeholderData: (previous) => previous,
  });
}

const orderKey = (id: string) => ['admin', 'order', id] as const;

export function useAdminOrder(id: string) {
  return useQuery({
    queryKey: orderKey(id),
    queryFn: () => apiRequest<AdminOrderDetail>(`/v1/admin/orders/${encodeURIComponent(id)}`),
  });
}

/** Cancel or refund with a reason. */
export function useOrderAction(id: string, action: 'cancel' | 'refund') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      apiRequest<AdminOrderDetail & { refund?: 'started' | 'retry_later' | 'none' }>(
        `/v1/admin/orders/${encodeURIComponent(id)}/${action}`,
        { method: 'POST', body: { reason } },
      ),
    onSuccess: (data) => queryClient.setQueryData(orderKey(id), data),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] }),
  });
}
