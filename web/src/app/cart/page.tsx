"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorBox, VegDot } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import { DEFAULT_FEES, feePreview, inr } from "@/lib/money";
import { createPayment, openCheckout } from "@/lib/razorpay";
import { errorMessage, supabase } from "@/lib/supabase";
import type { Order, PaymentMode, PlatformSettings } from "@/lib/types";

export default function CartPage() {
  const cart = useCart();
  const { session, profile } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<PaymentMode>("online");
  const [fees, setFees] = useState(DEFAULT_FEES);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("platform_settings")
      .select("online_fee_percent, offline_fee_percent")
      .maybeSingle()
      .then(({ data }) => {
        const s = data as PlatformSettings | null;
        if (s) setFees({ online: Number(s.online_fee_percent), offline: Number(s.offline_fee_percent) });
      });
  }, []);

  if (cart.count === 0 || !cart.stall) {
    return (
      <div className="py-16 text-center">
        <p className="text-lg font-semibold">Your cart is empty</p>
        <Link href="/" className="btn-primary mt-4">
          Browse stalls
        </Link>
      </div>
    );
  }

  const { fee, total } = feePreview(cart.subtotal, fees[mode]);

  async function placeOrder() {
    if (!session) {
      router.push("/login?next=/cart");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, error } = await supabase.rpc("place_order", {
        p_stall_id: cart.stall!.id,
        p_items: Object.values(cart.lines).map((l) => ({ menu_item_id: l.item.id, quantity: l.quantity })),
        p_payment_mode: mode,
        p_note: note || null,
      });
      if (error) throw error;
      const order = data as Order;

      if (mode === "online") {
        cart.clear(); // order exists now; if payment is abandoned they can retry from the order page
        try {
          const params = await createPayment(order.id);
          await openCheckout({ ...params, prefill: { email: profile?.email ?? undefined, name: profile?.full_name ?? undefined } });
        } catch (e) {
          // Payment closed/failed — the order page offers "Pay now" again.
          router.push(`/orders/${order.id}?payment_error=${encodeURIComponent(errorMessage(e))}`);
          return;
        }
      } else {
        cart.clear();
      }
      router.push(`/orders/${order.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="text-2xl font-extrabold">Your order</h1>
      <p className="text-sm text-muted">
        From <b className="text-foreground">{cart.stall.name}</b>
      </p>

      <div className="card divide-y divide-border">
        {Object.values(cart.lines).map(({ item, quantity }) => (
          <div key={item.id} className="flex items-center gap-3 p-4">
            <VegDot veg={item.is_veg} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{item.name}</p>
              <p className="text-sm text-muted">{inr(item.price_paise)}</p>
            </div>
            <div className="flex items-center rounded-xl border border-brand text-brand">
              <button className="px-3 py-1 font-bold" onClick={() => cart.remove(item.id)}>
                −
              </button>
              <span className="w-6 text-center font-bold">{quantity}</span>
              <button className="px-3 py-1 font-bold" onClick={() => cart.add(cart.stall!, item)}>
                +
              </button>
            </div>
            <p className="w-16 text-right font-semibold">{inr(item.price_paise * quantity)}</p>
          </div>
        ))}
      </div>

      <textarea
        className="input"
        rows={2}
        maxLength={200}
        placeholder="Note for the stall (less spicy, no onion…)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <div className="space-y-2">
        <h2 className="font-bold">How do you want to pay?</h2>
        <PayOption
          active={mode === "online"}
          onClick={() => setMode("online")}
          title="Pay online now"
          subtitle={`UPI, cards, wallets · ${fees.online}% convenience fee`}
          badge="Cheapest"
        />
        <PayOption
          active={mode === "offline"}
          onClick={() => setMode("offline")}
          title="Pay at the counter"
          subtitle={`Cash/UPI at the stall when you collect · ${fees.offline}% extra charge`}
        />
      </div>

      <div className="card space-y-2 p-4 text-sm">
        <Row label="Item total" value={inr(cart.subtotal)} />
        <Row
          label={mode === "online" ? `Convenience fee (${fees.online}%)` : `Pay-at-counter charge (${fees.offline}%)`}
          value={inr(fee)}
        />
        <div className="border-t border-border pt-2">
          <Row label={<b>To pay</b>} value={<b className="text-base">{inr(total)}</b>} />
        </div>
        {mode === "offline" && (
          <p className="text-xs text-muted">
            Save {inr(feePreview(cart.subtotal, fees.offline).fee - feePreview(cart.subtotal, fees.online).fee)} by paying
            online.
          </p>
        )}
      </div>

      <ErrorBox message={error} />

      <button className="btn-primary w-full py-4 text-base" disabled={busy} onClick={placeOrder}>
        {busy
          ? "Placing order…"
          : !session
            ? "Sign in to order"
            : mode === "online"
              ? `Pay ${inr(total)}`
              : `Place order · pay ${inr(total)} at counter`}
      </button>
    </div>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function PayOption(props: { active: boolean; onClick: () => void; title: string; subtitle: string; badge?: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`card flex w-full items-center gap-3 p-4 text-left transition ${props.active ? "border-brand ring-2 ring-brand/30" : ""}`}
    >
      <span
        className={`grid h-5 w-5 place-items-center rounded-full border-2 ${props.active ? "border-brand" : "border-border"}`}
      >
        {props.active && <span className="h-2.5 w-2.5 rounded-full bg-brand" />}
      </span>
      <span className="flex-1">
        <span className="flex items-center gap-2 font-semibold">
          {props.title}
          {props.badge && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-950 dark:text-green-300">
              {props.badge}
            </span>
          )}
        </span>
        <span className="block text-xs text-muted">{props.subtitle}</span>
      </span>
    </button>
  );
}
