"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorBox, RequireAuth, Spinner } from "@/components/ui";
import { inr } from "@/lib/money";
import { errorMessage, supabase } from "@/lib/supabase";
import type { PlatformSettings, Stall } from "@/lib/types";

interface Stats {
  total_orders: number;
  paid_orders: number;
  gmv_paise: number;
  fee_revenue_paise: number;
  online_orders: number;
  offline_orders: number;
}

export default function AdminPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <Admin />
    </RequireAuth>
  );
}

const BLANK = { name: "", cuisine: "", location: "", description: "", owner_email: "" };

function Admin() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [stalls, setStalls] = useState<(Stall & { profiles: { email: string | null } | null })[] | null>(null);
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, st, sl] = await Promise.all([
      supabase.rpc("admin_stats").single(),
      supabase.from("platform_settings").select("*").single(),
      supabase.from("stalls").select("*, profiles(email)").order("name"),
    ]);
    const err = s.error ?? st.error ?? sl.error;
    setError(err ? errorMessage(err) : null);
    setStats(s.data as Stats);
    setSettings(st.data as PlatformSettings);
    setStalls((sl.data as never) ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  async function saveFees(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabase
      .from("platform_settings")
      .update({
        online_fee_percent: Number(f.get("online")),
        offline_fee_percent: Number(f.get("offline")),
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);
    setError(error ? errorMessage(error) : null);
    setMsg(error ? null : "Fees updated");
    load();
  }

  async function createStall(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    const { data, error } = await supabase
      .from("stalls")
      .insert({
        name: form.name.trim(),
        cuisine: form.cuisine.trim() || null,
        location: form.location.trim() || null,
        description: form.description.trim() || null,
      })
      .select()
      .single();
    if (error) return setError(errorMessage(error));
    if (form.owner_email.trim()) await assignOwner((data as Stall).id, form.owner_email);
    setForm(BLANK);
    setMsg(`Created ${form.name}`);
    load();
  }

  async function assignOwner(stallId: string, email: string) {
    const { error } = await supabase.rpc("admin_assign_stall_owner", { p_stall_id: stallId, p_owner_email: email });
    if (error) setError(errorMessage(error));
    else setMsg(`Linked ${email}`);
    load();
  }

  if (!stats || !settings || !stalls) return error ? <ErrorBox message={error} /> : <Spinner />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold">MOM admin</h1>
      <ErrorBox message={error} />
      {msg && <p className="text-sm font-semibold text-green-700">{msg}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Platform revenue (fees)" value={inr(stats.fee_revenue_paise)} highlight />
        <Stat label="Food value (GMV)" value={inr(stats.gmv_paise)} />
        <Stat label="Paid orders" value={`${stats.paid_orders} / ${stats.total_orders}`} />
        <Stat label="Online vs counter" value={`${stats.online_orders} : ${stats.offline_orders}`} />
      </div>

      <form onSubmit={saveFees} className="card flex flex-wrap items-end gap-3 p-4">
        <h2 className="w-full font-bold">Fees</h2>
        <label className="text-sm">
          Online convenience fee %
          <input name="online" className="input mt-1 w-32" type="number" step="0.01" min={0} max={100} defaultValue={settings.online_fee_percent} />
        </label>
        <label className="text-sm">
          Pay-at-counter charge %
          <input name="offline" className="input mt-1 w-32" type="number" step="0.01" min={0} max={100} defaultValue={settings.offline_fee_percent} />
        </label>
        <button className="btn-primary">Save</button>
      </form>

      <form onSubmit={createStall} className="card grid gap-3 p-4 sm:grid-cols-2">
        <h2 className="font-bold sm:col-span-2">Onboard a stall</h2>
        <input className="input" required placeholder="Stall name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input" placeholder="Cuisine" value={form.cuisine} onChange={(e) => setForm({ ...form, cuisine: e.target.value })} />
        <input className="input" placeholder="Location (e.g. Near Main Gate)" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        <input className="input" placeholder="Owner's email (they must sign in once first)" value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} />
        <input className="input sm:col-span-2" placeholder="Short description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <button className="btn-primary sm:col-span-2">Create stall</button>
      </form>

      <div className="card divide-y divide-border">
        {stalls.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {s.name} <span className="text-xs text-muted">{s.is_open ? "· open" : "· closed"}</span>
              </p>
              <p className="text-xs text-muted">Owner: {s.profiles?.email ?? "not linked"}</p>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const email = new FormData(e.currentTarget).get("email") as string;
                if (email) assignOwner(s.id, email);
              }}
            >
              <input name="email" className="input w-56" placeholder="owner@email.com" />
              <button className="btn-ghost">Link owner</button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`card p-4 ${highlight ? "border-brand bg-brand-soft" : ""}`}>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-xl font-extrabold">{value}</p>
    </div>
  );
}
