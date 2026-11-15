"use client";

import Link from "next/link";
import type { Stall } from "@/lib/types";

export function VendorNav({
  stalls,
  stall,
  select,
  active,
}: {
  stalls: Stall[];
  stall: Stall;
  select: (id: string) => void;
  active: "orders" | "menu";
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {stalls.length > 1 ? (
        <select className="input w-auto font-bold" value={stall.id} onChange={(e) => select(e.target.value)}>
          {stalls.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      ) : (
        <h1 className="text-2xl font-extrabold">{stall.name}</h1>
      )}
      <div className="ml-auto flex rounded-xl border border-border bg-surface p-1 text-sm font-semibold">
        <Link
          href="/vendor"
          className={`rounded-lg px-3 py-1.5 ${active === "orders" ? "bg-brand text-white" : ""}`}
        >
          Live orders
        </Link>
        <Link
          href="/vendor/menu"
          className={`rounded-lg px-3 py-1.5 ${active === "menu" ? "bg-brand text-white" : ""}`}
        >
          Menu & stall
        </Link>
      </div>
    </div>
  );
}

export function NoStall() {
  return (
    <div className="card mx-auto max-w-md p-6 text-center">
      <p className="font-semibold">No stall is linked to your account yet.</p>
      <p className="mt-1 text-sm text-muted">Ask the MOM team to link your stall to the email you signed in with.</p>
    </div>
  );
}
