"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ErrorBox, Spinner, VegDot } from "@/components/ui";
import { useCart } from "@/lib/cart";
import { inr } from "@/lib/money";
import { errorMessage, supabase } from "@/lib/supabase";
import type { MenuItem, Stall } from "@/lib/types";

export default function StallPage() {
  const { id } = useParams<{ id: string }>();
  const cart = useCart();
  const [stall, setStall] = useState<Stall | null>(null);
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vegOnly, setVegOnly] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("stalls").select("*").eq("id", id).maybeSingle(),
      supabase.from("menu_items").select("*").eq("stall_id", id).order("sort_order").order("name"),
    ]).then(([s, m]) => {
      if (s.error || m.error) setError(errorMessage(s.error ?? m.error));
      setStall(s.data as Stall | null);
      setMenu((m.data as MenuItem[]) ?? []);
    });
  }, [id]);

  const grouped = useMemo(() => {
    const groups = new Map<string, MenuItem[]>();
    for (const item of menu ?? []) {
      if (vegOnly && !item.is_veg) continue;
      groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
    }
    return [...groups.entries()];
  }, [menu, vegOnly]);

  if (!menu) return <Spinner />;
  if (!stall) return <ErrorBox message={error ?? "Stall not found"} />;

  function add(item: MenuItem) {
    if (!stall) return;
    if (!cart.add(stall, item)) {
      const ok = confirm(
        `Your cart has items from ${cart.stall?.name}. Start a new cart with ${stall.name}?`,
      );
      if (ok) cart.startNew(stall, item);
    }
  }

  const cartHere = cart.stall?.id === stall.id && cart.count > 0;

  return (
    <div className="space-y-6 pb-24">
      <div>
        <Link href="/" className="text-sm text-muted hover:text-brand">
          ← All stalls
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{stall.name}</h1>
        <p className="text-muted">
          {stall.cuisine} · 📍 {stall.location} · ~{stall.avg_prep_mins} min
        </p>
        {stall.description && <p className="mt-1 text-sm">{stall.description}</p>}
        {!stall.is_open && (
          <p className="mt-3 rounded-xl bg-stone-200 px-3 py-2 text-sm font-medium dark:bg-stone-800">
            This stall is closed right now — you can browse the menu but not order.
          </p>
        )}
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={vegOnly} onChange={(e) => setVegOnly(e.target.checked)} />
        <VegDot veg /> Veg only
      </label>

      <ErrorBox message={error} />

      {grouped.map(([category, items]) => (
        <section key={category}>
          <h2 className="mb-2 text-lg font-bold">{category}</h2>
          <div className="card divide-y divide-border">
            {items.map((item) => {
              const qty = cart.stall?.id === stall.id ? cart.quantityOf(item.id) : 0;
              const orderable = stall.is_open && item.is_available;
              return (
                <div key={item.id} className={`flex items-center gap-3 p-4 ${item.is_available ? "" : "opacity-50"}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <VegDot veg={item.is_veg} />
                      <span className="font-semibold">{item.name}</span>
                    </div>
                    <p className="text-sm font-medium">{inr(item.price_paise)}</p>
                    {item.description && <p className="text-xs text-muted">{item.description}</p>}
                    {!item.is_available && <p className="text-xs font-semibold text-red-600">Sold out</p>}
                  </div>
                  {qty > 0 ? (
                    <div className="flex items-center rounded-xl border border-brand text-brand">
                      <button className="px-3 py-1.5 text-lg font-bold" onClick={() => cart.remove(item.id)}>
                        −
                      </button>
                      <span className="w-6 text-center font-bold">{qty}</span>
                      <button
                        className="px-3 py-1.5 text-lg font-bold"
                        disabled={!orderable}
                        onClick={() => add(item)}
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <button className="btn-ghost text-brand" disabled={!orderable} onClick={() => add(item)}>
                      ADD
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {cartHere && (
        <div className="fixed inset-x-0 bottom-0 z-10 p-4">
          <Link
            href="/cart"
            className="btn-primary mx-auto flex max-w-5xl justify-between rounded-2xl px-5 py-4 text-base shadow-lg"
          >
            <span>
              {cart.count} item{cart.count > 1 ? "s" : ""} · {inr(cart.subtotal)}
            </span>
            <span>View cart →</span>
          </Link>
        </div>
      )}
    </div>
  );
}
