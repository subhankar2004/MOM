"use client";

import { functionsUrl, supabase } from "./supabase";

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface CheckoutParams {
  key_id: string;
  razorpay_order_id: string;
  amount: number;
  currency: string;
  description: string;
  prefill?: { email?: string; contact?: string; name?: string };
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Razorpay?: any;
  }
}

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load Razorpay. Check your internet connection."));
    document.body.appendChild(s);
  });
}

/** Ask our Edge Function to create the Razorpay order for a MOM order. */
export async function createPayment(orderId: string): Promise<CheckoutParams> {
  const { data, error } = await supabase.functions.invoke("create-payment", {
    body: { order_id: orderId },
  });
  if (error) {
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(body?.error ?? error.message);
  }
  return data as CheckoutParams;
}

/** Verify the payment signature server-side; returns the issued token. */
export async function verifyPayment(res: RazorpaySuccess) {
  const r = await fetch(`${functionsUrl}/verify-payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    },
    body: JSON.stringify(res),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? "Payment verification failed");
  return body as { order_id: string; token_no: number; status: string };
}

/**
 * Opens Razorpay Checkout. Resolves after the payment is verified by our
 * server, rejects if the student closes the popup or payment fails.
 */
export async function openCheckout(params: CheckoutParams) {
  await loadScript();
  return new Promise<{ token_no: number }>((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: params.key_id,
      order_id: params.razorpay_order_id,
      amount: params.amount,
      currency: params.currency,
      name: "MOM",
      description: params.description,
      prefill: params.prefill,
      theme: { color: "#ea580c" },
      handler: async (res: RazorpaySuccess) => {
        try {
          resolve(await verifyPayment(res));
        } catch (e) {
          reject(e);
        }
      },
      modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
    });
    // On payment.failed Razorpay keeps its modal open so the student can
    // retry with another method; we only give up when they close it.
    rzp.open();
  });
}
