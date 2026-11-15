"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NoStall, VendorNav } from "@/components/stall-switcher";
import { ErrorBox, RequireAuth, Spinner } from "@/components/ui";
import { inr } from "@/lib/money";
import { errorMessage, supabase } from "@/lib/supabase";
import type { OrderStatus, PaymentMode, PaymentStatus } from "@/lib/types";
import { useMyStalls } from "@/lib/use-my-stall";

interface LiveOrder {
  id: string;
  token_no: number;
  status: OrderStatus;
  payment_mode: PaymentMode;
  payment_status: PaymentStatus;
  total_paise: number;
  subtotal_paise: number;
  note: string | null;
  created_at: string;
  customer_name: string;
  items: { name: string; quantity: number }[];
}

const COLUMNS: { status: OrderStatus; title: string; next?: OrderStatus; action?: string }[] = [
  { status: "placed", title: "New", next: "preparing", action: "Start preparing" },
  { status: "preparing", title: "Preparing", next: "ready", action: "Mark ready" },
  { status: "ready", title: "Ready for pickup", next: "completed", action: "Handed over" },
];

export default function VendorPage() {
  return (
    <RequireAuth roles={["vendor", "admin"]}>
      <Dashboard />
    </RequireAuth>
  );
}

function Dashboard() {
  const { stalls, stall, select } = useMyStalls();
  const [orders, setOrders] = useState<LiveOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const known = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    if (!stall) return;
    const { data, error } = await supabase.rpc("stall_orders_today", { p_stall_id: stall.id });
    if (error) return setError(errorMessage(error));
    const list = data as LiveOrder[];
    // Chime when a brand-new order shows up (not on first load).
    if (known.current && list.some((o) => o.status === "placed" && !known.current!.has(o.id))) chime();
    known.current = new Set(list.map((o) => o.id));
    setOrders(list);
  }, [stall]);

  useEffect(() => {
    if (!stall) return;
    known.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
    const ch = supabase
      .channel(`stall-${stall.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `stall_id=eq.${stall.id}` }, load)
      .subscribe();
    const poll = setInterval(load, 30_000); // safety net if realtime drops
    return () => {
      supabase.removeChannel(ch);
      clearInterval(poll);
    };
  }, [stall, load]);

  async function move(o: LiveOrder, status: OrderStatus) {
    if (status === "cancelled") {
      const paid = o.payment_status === "paid";
      if (!confirm(`Cancel token #${o.token_no}?${paid ? " This order was paid online and will need a refund." : ""}`))
        return;
    }
    const { error } = await supabase.rpc("update_order_status", { p_order_id: o.id, p_status: status });
    if (error) setError(errorMessage(error));
    load();
  }

  if (!stalls) return <Spinner />;
  if (!stall) return <NoStall />;

  const completed = orders?.filter((o) => o.status === "completed") ?? [];
  const sales = completed.reduce((n, o) => n + o.subtotal_paise, 0);

  return (
    <div className="space-y-5">
      <VendorNav stalls={stalls} stall={stall} select={select} active="orders" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Stall" value={stall.is_open ? "Open" : "Closed"} />
        <Stat label="Active orders" value={String(orders?.filter((o) => ["placed", "preparing", "ready"].includes(o.status)).length ?? 0)} />
        <Stat label="Collected today" value={String(completed.length)} />
        <Stat label="Food sales today" value={inr(sales)} />
      </div>

      <ErrorBox message={error} />
      {!orders ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const list = orders.filter((o) => o.status === col.status);
            return (
              <section key={col.status} className="space-y-3">
                <h2 className="flex items-center gap-2 font-bold">
                  {col.title}
                  <span className="rounded-full bg-brand-soft px-2 text-sm text-brand">{list.length}</span>
                </h2>
                {list.length === 0 && <p className="card p-4 text-center text-sm text-muted">Nothing here</p>}
                {list.map((o) => (
                  <article key={o.id} className="card space-y-3 p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-3xl font-black text-brand">#{o.token_no}</p>
                        <p className="text-sm font-semibold">{o.customer_name}</p>
                      </div>
                      <div className="text-right text-xs">
                        <p className="text-muted">
                          {new Date(o.created_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                        </p>
                        {o.payment_status === "pay_at_counter" ? (
                          <p className="mt-1 rounded-md bg-yellow-100 px-1.5 py-0.5 font-bold text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300">
                            Collect {inr(o.total_paise)}
                          </p>
                        ) : (
                          <p className="mt-1 rounded-md bg-green-100 px-1.5 py-0.5 font-bold text-green-800 dark:bg-green-950 dark:text-green-300">
                            Paid online
                          </p>
                        )}
                      </div>
                    </div>
                    <ul className="space-y-0.5 text-sm">
                      {o.items.map((i, idx) => (
                        <li key={idx}>
                          <b>{i.quantity}×</b> {i.name}
                        </li>
                      ))}
                    </ul>
                    {o.note && <p className="rounded-lg bg-brand-soft px-2 py-1 text-xs">📝 {o.note}</p>}
                    <div className="flex gap-2">
                      <button className="btn-primary flex-1" onClick={() => move(o, col.next!)}>
                        {col.action}
                      </button>
                      <button className="btn-ghost text-red-600" onClick={() => move(o, "cancelled")}>
                        ✕
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

function chime() {
  try {
    const ctx = new AudioContext();
    [0, 0.18].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = i ? 1046 : 784;
      g.gain.setValueAtTime(0.2, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.3);
    });
  } catch {
    /* audio blocked until the page is clicked once */
  }
}
