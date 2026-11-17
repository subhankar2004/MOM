import { pgEnum } from 'drizzle-orm/pg-core';

/** Global role used for routing. Stall-level access is decided by `stall_members`. */
export const userRole = pgEnum('user_role', ['student', 'vendor_owner', 'vendor_staff', 'super_admin']);
export const userStatus = pgEnum('user_status', ['active', 'suspended']);

export const stallStatus = pgEnum('stall_status', ['draft', 'active', 'suspended']);
export const stallMemberRole = pgEnum('stall_member_role', ['owner', 'staff']);
/** Razorpay Route linked-account onboarding state (spec §4.2). */
export const routeStatus = pgEnum('route_status', [
  'not_started',
  'pending',
  'activated',
  'rejected',
  'suspended',
]);

export const paymentMethod = pgEnum('payment_method', ['upi', 'cash']);

/** Order lifecycle (spec §5). */
export const orderStatus = pgEnum('order_status', [
  'pending_payment',
  'placed',
  'preparing',
  'ready',
  'collected',
  'rejected',
  'cancelled',
  'expired',
]);

/** Money state of an order, independent of its kitchen status. */
export const orderPaymentStatus = pgEnum('order_payment_status', [
  'pending', // UPI: waiting for payment
  'paid', // UPI: captured
  'due', // cash: to be collected at the counter
  'paid_cash', // cash: collected at hand-over
  'refund_pending',
  'refunded',
  'failed',
]);

export const paymentProvider = pgEnum('payment_provider', ['razorpay']);
export const paymentAttemptStatus = pgEnum('payment_attempt_status', [
  'created',
  'authorized',
  'captured',
  'failed',
]);
export const refundStatus = pgEnum('refund_status', ['pending', 'processed', 'failed']);
export const transferStatus = pgEnum('transfer_status', [
  'created',
  'on_hold',
  'released',
  'reversed',
  'failed',
]);

export const ledgerEntryType = pgEnum('ledger_entry_type', [
  'platform_fee',
  'cash_fee',
  'refund_reversal',
  'settlement',
  'adjustment',
]);
/** From MOM's point of view: credit = MOM earns / is owed, debit = MOM gives back / pays out. */
export const ledgerDirection = pgEnum('ledger_direction', ['credit', 'debit']);
