"use client";

import { useCallback, useEffect, useState } from "react";
import { NoStall, VendorNav } from "@/components/stall-switcher";
import { ErrorBox, RequireAuth, Spinner, VegDot } from "@/components/ui";
import { inr } from "@/lib/money";
import { errorMessage, supabase } from "@/lib/supabase";
import type { MenuItem, Stall } from "@/lib/types";
import { useMyStalls } from "@/lib/use-my-stall";

export default function VendorMenuPage() {
  return (
    <RequireAuth roles={["vendor", "admin"]}>
      <MenuEditor />
    </RequireAuth>
  );
}

const BLANK = { name: "", category: "", price: "", is_veg: true, description: "" };

function MenuEditor() {
  const { stalls, stall, select, reload } = useMyStalls();
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!stall) return;
    const { data, error } = await supabase
      .from("menu_items")
      .select("*")
      .eq("stall_id", stall.id)
      .order("category")
      .order("sort_order");
    if (error) setError(errorMessage(error));
    setItems((data as MenuItem[]) ?? []);
  }, [stall]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  async function run(p: PromiseLike<{ error: unknown }>) {
    setError(null);
    const { error } = await p;
    if (error) setError(errorMessage(error));
    await load();
  }

  async function updateStall(patch: Partial<Stall>) {
    if (!stall) return;
    const { error } = await supabase.from("stalls").update(patch).eq("id", stall.id);
    if (error) setError(errorMessage(error));
    await reload();
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!stall) return;
    const price = Math.round(parseFloat(form.price) * 100);
    if (!form.name.trim() || !(price > 0)) return setError("Enter a name and a valid price");
    await run(
      supabase.from("menu_items").insert({
        stall_id: stall.id,
        name: form.name.trim(),
        category: form.category.trim() || "Other",
        price_paise: price,
        is_veg: form.is_veg,
        description: form.description.trim() || null,
        sort_order: (items?.length ?? 0) + 1,
      }),
    );
    setForm(BLANK);
  }

  if (!stalls) return <Spinner />;
  if (!stall) return <NoStall />;

  return (
    <div className="space-y-5">
      <VendorNav stalls={stalls} stall={stall} select={select} active="menu" />
      <ErrorBox message={error} />

      <section className="card flex flex-wrap items-center gap-4 p-4">
        <div className="flex-1">
          <p className="font-bold">Accepting orders</p>
          <p className="text-sm text-muted">Turn off when you close or get too busy.</p>
        </div>
        <Toggle on={stall.is_open} onChange={(v) => updateStall({ is_open: v })} />
        <label className="flex items-center gap-2 text-sm">
          Avg. prep time
          <input
            className="input w-20"
            type="number"
            min={1}
            defaultValue={stall.avg_prep_mins}
            onBlur={(e) => updateStall({ avg_prep_mins: Math.max(1, Number(e.target.value) || 15) })}
          />
          min
        </label>
      </section>

      <form onSubmit={addItem} className="card grid gap-3 p-4 sm:grid-cols-6">
        <h2 className="font-bold sm:col-span-6">Add an item</h2>
        <input className="input sm:col-span-2" placeholder="Item name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input sm:col-span-2" placeholder="Category (e.g. Dosa)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <input className="input" placeholder="Price ₹" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        <select className="input" value={form.is_veg ? "veg" : "nonveg"} onChange={(e) => setForm({ ...form, is_veg: e.target.value === "veg" })}>
          <option value="veg">Veg</option>
          <option value="nonveg">Non-veg</option>
        </select>
        <input className="input sm:col-span-5" placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <button className="btn-primary">Add</button>
      </form>

      {!items ? (
        <Spinner />
      ) : (
        <div className="card divide-y divide-border">
          {items.length === 0 && <p className="p-4 text-center text-sm text-muted">No items yet — add your first one above.</p>}
          {items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center gap-3 p-4">
              <VegDot veg={item.is_veg} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{item.name}</p>
                <p className="text-xs text-muted">{item.category}</p>
              </div>
              <label className="flex items-center gap-1 text-sm">
                ₹
                <input
                  className="input w-24"
                  inputMode="decimal"
                  defaultValue={item.price_paise / 100}
                  onBlur={(e) => {
                    const p = Math.round(parseFloat(e.target.value) * 100);
                    if (p > 0 && p !== item.price_paise)
                      run(supabase.from("menu_items").update({ price_paise: p }).eq("id", item.id));
                  }}
                />
              </label>
              <div className="flex items-center gap-2 text-sm">
                <span className={item.is_available ? "" : "text-red-600"}>{item.is_available ? "In stock" : "Sold out"}</span>
                <Toggle
                  on={item.is_available}
                  onChange={(v) => run(supabase.from("menu_items").update({ is_available: v }).eq("id", item.id))}
                />
              </div>
              <button
                className="text-sm text-red-600 underline"
                onClick={() =>
                  confirm(`Delete ${item.name}?`) && run(supabase.from("menu_items").delete().eq("id", item.id))
                }
              >
                Delete
              </button>
              <span className="sr-only">{inr(item.price_paise)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 rounded-full transition ${on ? "bg-green-600" : "bg-stone-300 dark:bg-stone-700"}`}
    >
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`} />
    </button>
  );
}
