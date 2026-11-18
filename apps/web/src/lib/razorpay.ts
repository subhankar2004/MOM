'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import type { Order } from './orders';

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', handler: (response: unknown) => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

let loading: Promise<void> | null = null;

/** Loads Razorpay Checkout once, only when the student actually pays. */
export function loadRazorpay(): Promise<void> {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error('Could not load the payment window. Check your connection and try again.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export class PaymentDismissed extends Error {
  constructor() {
    super('Payment was not completed. You can try again.');
    this.name = 'PaymentDismissed';
  }
}

interface StartResponse {
  keyId: string;
  razorpayOrderId: string;
  amountPaise: number;
  currency: 'INR';
  orderId: string;
  prefill: { contact?: string; name?: string };
}

/**
 * Opens Razorpay Checkout with the signed result, or rejects if closed.
 * Razorpay lists UPI first by itself when the account has it enabled.
 */
function openCheckout(start: StartResponse, stallName: string): Promise<RazorpaySuccess> {
  return new Promise((resolve, reject) => {
    const Razorpay = window.Razorpay;
    if (!Razorpay) return reject(new Error('The payment window is not available.'));
    const checkout = new Razorpay({
      key: start.keyId,
      order_id: start.razorpayOrderId,
      amount: start.amountPaise,
      currency: start.currency,
      name: 'MOM',
      description: `Order at ${stallName}`,
      prefill: start.prefill,
      theme: { color: '#2B3484' },
      handler: resolve,
      modal: { ondismiss: () => reject(new PaymentDismissed()), confirm_close: true },
    });
    // A failed attempt (e.g. UPI declined) keeps the window open so the student can retry there.
    checkout.on('payment.failed', () => {});
    checkout.open();
  });
}

/**
 * The whole UPI payment: our API makes a Razorpay order → Checkout → our API verifies the
 * signature and issues the token. The webhook confirms it too, if the browser goes away.
 */
export function usePayOrder(order: Pick<Order, 'id' | 'stall'>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const [start] = await Promise.all([
        apiRequest<StartResponse>('/v1/payments/razorpay/order', {
          method: 'POST',
          body: { orderId: order.id },
        }),
        loadRazorpay(),
      ]);
      const result = await openCheckout(start, order.stall.name);
      return apiRequest<{ order: Order }>('/v1/payments/razorpay/verify', {
        method: 'POST',
        body: {
          orderId: order.id,
          razorpayOrderId: result.razorpay_order_id,
          razorpayPaymentId: result.razorpay_payment_id,
          razorpaySignature: result.razorpay_signature,
        },
      });
    },
    onSuccess: ({ order: paid }) => queryClient.setQueryData(['order', paid.id], { order: paid }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['order', order.id] }),
  });
}
