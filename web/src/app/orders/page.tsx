"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorBox, RequireAuth, Spinner, StatusPill } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { inr } from "@/lib/money";
import { errorMessage, supabase } from "@/lib/supabase";
import type { Order } from "@/lib/types";

export default function OrdersPage() {
  return (
    <RequireAuth>
      <OrdersList />
    </RequireAuth>
  );
}

function OrdersList() {
  const { session } = useAuth();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const uid = session!.user.id;
    const load = () =>
      supabase
        .from("orders")
        .select("*, stalls(name, location), order_items(*)")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(50)
        .then(({ data, error }) => {
          if (error) setError(errorMessage(error));
          setOrders((data as Order[]) ?? []);
        });
    load();
    const ch = supabase
      .channel(`my-orders-${uid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `user_id=eq.${uid}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [session]);

  if (!orders) return <Spinner />;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-extrabold">Your orders</h1>
      <ErrorBox message={error} />
      {orders.length === 0 && (
        <p className="py-10 text-center text-muted">
          No orders yet.{" "}
          <Link href="/" className="text-brand underline">
            Find something tasty
          </Link>
        </p>
      )}
      {orders.map((o) => (
        <Link key={o.id} href={`/orders/${o.id}`} className="card flex items-center gap-4 p-4 hover:border-brand">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-brand-soft text-center">
            <span className="text-[10px] font-semibold uppercase text-muted">Token</span>
            <span className="-mt-1 text-xl font-black text-brand">{o.token_no ?? "–"}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold">{o.stalls?.name}</p>
            <p className="truncate text-sm text-muted">
              {o.order_items?.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
            </p>
            <p className="text-xs text-muted">{new Date(o.created_at).toLocaleString("en-IN")}</p>
          </div>
          <div className="space-y-1 text-right">
            <StatusPill status={o.status} />
            <p className="text-sm font-semibold">{inr(o.total_paise)}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
