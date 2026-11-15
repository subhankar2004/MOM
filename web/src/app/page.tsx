"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ErrorBox, Spinner } from "@/components/ui";
import { errorMessage, supabase } from "@/lib/supabase";
import type { Stall } from "@/lib/types";

export default function HomePage() {
  const [stalls, setStalls] = useState<Stall[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    supabase
      .from("stalls")
      .select("*")
      .order("is_open", { ascending: false })
      .order("name")
      .then(({ data, error }) => {
        if (error) setError(errorMessage(error));
        setStalls((data as Stall[]) ?? []);
      });
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!stalls || !q) return stalls;
    return stalls.filter((s) =>
      [s.name, s.cuisine, s.description, s.location].some((f) => f?.toLowerCase().includes(q)),
    );
  }, [stalls, query]);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-brand px-6 py-8 text-white">
        <p className="text-sm font-medium opacity-90">Hungry between classes?</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">Order ahead. Skip the queue.</h1>
        <p className="mt-2 max-w-xl text-sm opacity-90">
          Pick a stall, order from the menu, pay online or at the counter, and collect your food with your token
          number.
        </p>
      </section>

      <input
        className="input"
        placeholder="Search stalls or cuisines — dosa, chinese, thali…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <ErrorBox message={error} />
      {!filtered ? (
        <Spinner label="Finding stalls near you…" />
      ) : filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">No stalls match “{query}”.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((s) => (
            <Link
              key={s.id}
              href={`/stalls/${s.id}`}
              className={`card group flex gap-4 p-4 transition hover:border-brand ${s.is_open ? "" : "opacity-60"}`}
            >
              <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-brand-soft text-3xl font-black text-brand">
                {s.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.image_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  s.name[0]
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-bold group-hover:text-brand">{s.name}</h2>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${s.is_open ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" : "bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-400"}`}
                  >
                    {s.is_open ? "Open" : "Closed"}
                  </span>
                </div>
                <p className="text-sm text-muted">{s.cuisine}</p>
                <p className="mt-1 line-clamp-1 text-sm">{s.description}</p>
                <p className="mt-1 text-xs text-muted">
                  📍 {s.location} · ~{s.avg_prep_mins} min
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
