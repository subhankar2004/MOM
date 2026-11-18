import { StatusChip } from '@/components/ui/status-chip';
import type { RouteStatus, StallStatus } from '@/lib/admin-stalls';

const STALL: Record<StallStatus, { label: string; tone: 'success' | 'neutral' | 'danger' }> = {
  active: { label: 'Live', tone: 'success' },
  draft: { label: 'Draft', tone: 'neutral' },
  suspended: { label: 'Suspended', tone: 'danger' },
};

export function StallStatusChip({ status }: { status: StallStatus }) {
  const s = STALL[status];
  return <StatusChip tone={s.tone}>{s.label}</StatusChip>;
}

const ROUTE: Record<RouteStatus, { label: string; tone: 'success' | 'neutral' | 'warning' | 'danger' }> = {
  activated: { label: 'Active', tone: 'success' },
  pending: { label: 'In review', tone: 'warning' },
  not_started: { label: 'Not set up', tone: 'neutral' },
  rejected: { label: 'Rejected', tone: 'danger' },
  suspended: { label: 'Suspended', tone: 'danger' },
};

/** Razorpay settlement (linked) account status. */
export function RouteStatusChip({ status }: { status: RouteStatus }) {
  const s = ROUTE[status];
  return <StatusChip tone={s.tone}>{s.label}</StatusChip>;
}
