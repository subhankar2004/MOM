"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ErrorBox, RequireAuth, Spinner, StatusPill } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { PAYMENT_LABEL, inr } from "@/lib/money";
import { createPayment, openCheckout } from "@/lib/razorpay";
import { errorMessage, supabase } from "@/lib/supabase";
import type { Order, OrderStatus } from "@/lib/types";

const STEPS: OrderStatus[] = ["placed", "preparing", "ready", "completed"];

export default function OrderPage() {
  return (
    <RequireAuth>
      <OrderDetail />
    </RequireAuth>
  );
}

function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const paymentError = useSearchParams().get("payment_error");
  const { profile } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(paymentError);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("*, stalls(name, location), order_items(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) setError(errorMessage(error));
    setOrder(data as Order | null);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
    const ch = supabase
      .channel(`order-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${id}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [id, load]);

  async function payNow() {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const params = await createPayment(order.id);
      await openCheckout({ ...params, prefill: { email: profile?.email ?? undefined, name: profile?.full_name ?? undefined } });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!order || !confirm("Cancel this order?")) return;
    const { error } = await supabase.rpc("cancel_my_order", { p_order_id: order.id });
    if (error) setError(errorMessage(error));
    await load();
  }

  if (order === null) return error ? <ErrorBox message={error} /> : <Spinner />;

  const stepIndex = STEPS.indexOf(order.status);

  return (
    <div className="mx-auto max-w-md space-y-5">
      <Link href="/orders" className="text-sm text-muted hover:text-brand">
        ← All orders
      </Link>

      <div
        className={`card p-6 text-center ${order.status === "ready" ? "border-green-500 ring-4 ring-green-500/20" : ""}`}
      >
        {order.token_no ? (
          <>
            <p className="text-sm font-semibold uppercase tracking-wider text-muted">Your token</p>
            <p className="my-2 text-7xl font-black tracking-tight text-brand">#{order.token_no}</p>
            <p className="font-semibold">{order.stalls?.name}</p>
            <p className="text-sm text-muted">📍 {order.stalls?.location}</p>
          </>
        ) : (
          <>
            <p className="text-lg font-bold">
              {order.status === "cancelled" ? "Order cancelled" : "Complete payment to get your token"}
            </p>
            <p className="text-sm text-muted">{order.stalls?.name}</p>
          </>
        )}
        <div className="mt-4">
          <StatusPill status={order.status} />
        </div>
        {order.status === "ready" && (
          <p className="mt-3 font-semibold text-green-700 dark:text-green-400">
            Your food is ready! Show token #{order.token_no} at the counter.
          </p>
        )}
      </div>

      {stepIndex >= 0 && (
        <ol className="flex justify-between text-xs">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 flex-col items-center gap-1">
              <span
                className={`h-2 w-full ${i === 0 ? "rounded-l-full" : ""} ${i === STEPS.length - 1 ? "rounded-r-full" : ""} ${i <= stepIndex ? "bg-brand" : "bg-border"}`}
              />
              <span className={i <= stepIndex ? "font-semibold" : "text-muted"}>
                {["Placed", "Preparing", "Ready", "Collected"][i]}
              </span>
            </li>
          ))}
        </ol>
      )}

      <ErrorBox message={error} />

      {order.status === "pending_payment" && (
        <button className="btn-primary w-full py-4 text-base" disabled={busy} onClick={payNow}>
          {busy ? "Opening payment…" : `Pay ${inr(order.total_paise)} now`}
        </button>
      )}

      <div className="card space-y-2 p-4 text-sm">
        {order.order_items?.map((i) => (
          <div key={i.id} className="flex justify-between">
            <span>
              {i.quantity} × {i.name}
            </span>
            <span>{inr(i.line_total_paise)}</span>
          </div>
        ))}
        <div className="space-y-1 border-t border-border pt-2">
          <div className="flex justify-between text-muted">
            <span>Item total</span>
            <span>{inr(order.subtotal_paise)}</span>
          </div>
          <div className="flex justify-between text-muted">
            <span>
              {order.payment_mode === "online" ? "Convenience fee" : "Pay-at-counter charge"} ({Number(order.fee_percent)}%)
            </span>
            <span>{inr(order.fee_paise)}</span>
          </div>
          <div className="flex justify-between font-bold">
            <span>Total</span>
            <span>{inr(order.total_paise)}</span>
          </div>
        </div>
        <p className="pt-1 text-xs text-muted">
          {order.payment_mode === "online" ? "Online" : "At counter"} · {PAYMENT_LABEL[order.payment_status]}
          {order.note && <> · Note: “{order.note}”</>}
        </p>
      </div>

      {(order.status === "pending_payment" ||
        (order.status === "placed" && order.payment_status === "pay_at_counter")) && (
        <button className="w-full text-sm text-red-600 underline" onClick={cancel}>
          Cancel order
        </button>
      )}
    </div>
  );
}
