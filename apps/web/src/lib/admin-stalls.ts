'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api-client';

export type StallStatus = 'draft' | 'active' | 'suspended';
export type RouteStatus = 'not_started' | 'pending' | 'activated' | 'rejected' | 'suspended';

export interface Checklist {
  menu: boolean;
  hours: boolean;
  photo: boolean;
  payments: boolean;
  owner: boolean;
}

export interface AdminStallRow {
  id: string;
  slug: string;
  name: string;
  location: string | null;
  status: StallStatus;
  routeStatus: RouteStatus;
  createdAt: string;
  checklist: Checklist;
}

export interface AdminStallDetail {
  stall: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    location: string | null;
    cuisineTags: string[];
    isVegOnly: boolean;
    status: StallStatus;
    photoUrl: string | null;
    upiEnabled: boolean;
    cashEnabled: boolean;
    routeStatus: RouteStatus;
    razorpayAccountId: string | null;
    createdAt: string;
  };
  checklist: Checklist;
  members: Array<{ userId: string; name: string | null; phone: string | null; role: 'owner' | 'staff' }>;
  pending: Array<{ phone: string; role: 'owner' | 'staff'; invitedAt: string }>;
  canTestActivate: boolean;
  /** Only after a status refresh: what Razorpay still needs. */
  requirements?: string[];
}

export interface StallDetailsInput {
  name?: string;
  slug?: string;
  description?: string | null;
  location?: string | null;
  cuisineTags?: string[];
  isVegOnly?: boolean;
  status?: StallStatus;
}

export interface SettlementInput {
  account: {
    email: string;
    phone: string;
    legalBusinessName: string;
    businessType: 'individual' | 'proprietorship';
    contactName: string;
    address: { street1: string; street2?: string; city: string; state: string; postalCode: string };
  };
  bank: { accountNumber: string; ifsc: string; beneficiaryName: string };
}

export const CHECKLIST_ITEMS: Array<{ key: keyof Checklist; label: string }> = [
  { key: 'owner', label: "Owner's phone registered" },
  { key: 'menu', label: 'At least one dish on the menu' },
  { key: 'hours', label: 'Opening hours set' },
  { key: 'photo', label: 'Stall photo added' },
  { key: 'payments', label: 'A payment method on' },
];

export const checklistDone = (c: Checklist) => Object.values(c).filter(Boolean).length;

const listKey = ['admin', 'stalls'] as const;
const detailKey = (id: string) => ['admin', 'stall', id] as const;
const base = (id: string) => `/v1/admin/stalls/${encodeURIComponent(id)}` as const;

export function useAdminStalls(filter: { q: string; status: StallStatus | 'all' }) {
  const params = new URLSearchParams();
  if (filter.q.trim()) params.set('q', filter.q.trim());
  if (filter.status !== 'all') params.set('status', filter.status);
  const query = params.toString();
  return useQuery({
    queryKey: [...listKey, query],
    queryFn: () => apiRequest<{ stalls: AdminStallRow[] }>(`/v1/admin/stalls${query ? `?${query}` : ''}`),
    select: (d) => d.stalls,
    placeholderData: (previous) => previous,
  });
}

export function useAdminStall(id: string) {
  return useQuery({ queryKey: detailKey(id), queryFn: () => apiRequest<AdminStallDetail>(base(id)) });
}

export function useCreateStall() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StallDetailsInput & { name: string }) =>
      apiRequest<{ id: string; slug: string }>('/v1/admin/stalls', { method: 'POST', body: input }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: listKey }),
  });
}

/** Any change that returns the stall's new detail. */
function useDetailMutation<T>(id: string, run: (input: T) => Promise<AdminStallDetail>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (data) => {
      queryClient.setQueryData(detailKey(id), data);
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
  });
}

export const useUpdateStall = (id: string) =>
  useDetailMutation(id, (input: StallDetailsInput) =>
    apiRequest<AdminStallDetail>(base(id), { method: 'PATCH', body: input }),
  );

export const useSetUpSettlement = (id: string) =>
  useDetailMutation(id, (input: SettlementInput) =>
    apiRequest<AdminStallDetail>(`${base(id)}/settlement-account`, { method: 'POST', body: input }),
  );

export const useRefreshSettlement = (id: string) =>
  useDetailMutation(id, () =>
    apiRequest<AdminStallDetail>(`${base(id)}/settlement-account/refresh`, { method: 'POST' }),
  );

export const useTestActivate = (id: string) =>
  useDetailMutation(id, () =>
    apiRequest<AdminStallDetail>(`${base(id)}/settlement-account/test-activate`, { method: 'POST' }),
  );

export function useRegisterMember(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { phone: string; role: 'owner' | 'staff' }) =>
      apiRequest<{ phone: string; role: 'owner' | 'staff'; activeNow: boolean }>(`${base(id)}/members`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: detailKey(id) });
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
  });
}

/** "Dosa, South Indian ,  " → ["Dosa", "South Indian"] (max 6). */
export function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ].slice(0, 6);
}
