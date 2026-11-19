import { StatusChip, type ChipTone } from '@/components/ui/status-chip';
import type { Order } from '@/lib/orders';

/** Short order status words, used in lists (student "My orders", admin explorer). */
export const SHORT_STATUS: Record<Order['status'], string> = {
  pending_payment: 'Waiting for payment',
  placed: 'Placed',
  preparing: 'Being prepared',
  ready: 'Ready to collect',
  collected: 'Collected',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  expired: 'Not paid',
};

export const STATUS_TONE: Record<Order['status'], ChipTone> = {
  pending_payment: 'warning',
  placed: 'haldi',
  preparing: 'haldi',
  ready: 'success',
  collected: 'neutral',
  rejected: 'danger',
  cancelled: 'neutral',
  expired: 'neutral',
};

export function OrderStatusChip({ status }: { status: Order['status'] }) {
  return <StatusChip tone={STATUS_TONE[status]}>{SHORT_STATUS[status]}</StatusChip>;
}

const PAYMENT: Record<Order['paymentStatus'], { label: string; tone: ChipTone }> = {
  pending: { label: 'Not paid yet', tone: 'warning' },
  paid: { label: 'UPI paid', tone: 'success' },
  due: { label: 'Cash due', tone: 'haldi' },
  paid_cash: { label: 'Cash paid', tone: 'success' },
  refund_pending: { label: 'Refund pending', tone: 'warning' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  failed: { label: 'Payment failed', tone: 'danger' },
};

/** Payment state in words (admin views). */
export function PaymentStatusChip({ status }: { status: Order['paymentStatus'] }) {
  const p = PAYMENT[status];
  return <StatusChip tone={p.tone}>{p.label}</StatusChip>;
}
