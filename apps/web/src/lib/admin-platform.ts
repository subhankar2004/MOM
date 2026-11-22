'use client';

import { calcFees } from '@mom/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import { queryString } from './admin-console';

export interface PlatformSettings {
  id: number;
  platformFeeBps: number;
  cashFeeBps: number;
  maxOpenCashOrders: number;
  cashStrikeLimit: number;
  orderExpiryMinutes: number;
  congestionLowMaxMinutes: number;
  congestionModerateMaxMinutes: number;
  cashEnabledGlobally: boolean;
  orderingPaused: boolean;
  effectiveFrom: string;
}

export type SettingsForm = Omit<PlatformSettings, 'id' | 'effectiveFrom'>;
export type SettingsVersion = PlatformSettings & { createdBy: string | null; createdAt: string };

export function useSettingsOverview() {
  return useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () =>
      apiRequest<{ current: PlatformSettings; scheduled: SettingsVersion[]; history: SettingsVersion[] }>(
        '/v1/admin/settings',
      ),
  });
}

export function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SettingsForm & { effectiveFrom?: string }) =>
      apiRequest<{ settings: PlatformSettings }>('/v1/admin/settings', { method: 'POST', body: input }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });
}

export function useCancelScheduled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiRequest(`/v1/admin/settings/${id}`, { method: 'DELETE' }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] }),
  });
}

/** "1.5" (%) → 150 bps; null when it isn't a percentage with at most 2 decimals. */
export function percentToBps(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export const bpsToPercent = (bps: number) =>
  bps % 100 === 0 ? String(bps / 100) : (bps / 100).toFixed(2).replace(/0$/, '');

/** What a student pays on a ₹100 order with these fees (the settings page preview). */
export function feePreview(platformFeeBps: number, cashFeeBps: number) {
  const rates = { platformFeeBps, cashFeeBps };
  return { upi: calcFees(10_000, 'upi', rates), cash: calcFees(10_000, 'cash', rates) };
}

// ── Audit log (spec §6.3 A8) ────────────────────────────────────────────

export interface AuditEntry {
  id: number;
  createdAt: string;
  actor: { id: string; name: string | null; phone: string | null } | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
}

export interface AuditFilter {
  actor: string;
  entity: string;
  entityId: string;
  action: string;
  from: string;
  to: string;
}

export function useAudit(filter: AuditFilter) {
  return useInfiniteQuery({
    queryKey: ['admin', 'audit', filter],
    queryFn: ({ pageParam }) =>
      apiRequest<{ entries: AuditEntry[]; nextBefore: number | null }>(
        `/v1/admin/audit${queryString({ ...filter, before: pageParam === undefined ? undefined : String(pageParam) })}`,
      ),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    placeholderData: (previous) => previous,
  });
}

/** Field-by-field changes between an audit entry's before and after (objects only). */
export function auditDiff(
  before: unknown,
  after: unknown,
): Array<{ field: string; before: string; after: string }> {
  const obj = (v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const b = obj(before);
  const a = obj(after);
  const show = (v: unknown) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].map((field) => ({
    field,
    before: show(b[field]),
    after: show(a[field]),
  }));
}
