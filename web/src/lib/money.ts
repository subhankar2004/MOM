import type { OrderStatus, PaymentMode, PaymentStatus } from "./types";

/** ₹ formatting from integer paise. 13650 → "₹136.50", 4000 → "₹40" */
export function inr(paise: number): string {
  const rupees = paise / 100;
  return (
    "₹" +
    rupees.toLocaleString("en-IN", {
      minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
}

/**
 * Client-side PREVIEW of the fee. The database (place_order) computes the
 * real number with the same formula: round(subtotal × percent / 100).
 */
export function feePreview(subtotalPaise: number, percent: number) {
  const fee = Math.round((subtotalPaise * percent) / 100);
  return { fee, total: subtotalPaise + fee };
}

export const DEFAULT_FEES: Record<PaymentMode, number> = { online: 1, offline: 5 };

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "Awaiting payment",
  placed: "Order placed",
  preparing: "Preparing",
  ready: "Ready for pickup",
  completed: "Collected",
  cancelled: "Cancelled",
};

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  pending: "Payment pending",
  paid: "Paid",
  pay_at_counter: "Pay at counter",
  failed: "Payment failed",
  refunded: "Refunded",
};
