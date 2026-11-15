"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase";
import type { OrderStatus, UserRole } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/money";

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <p className="py-16 text-center text-sm text-muted">{label}</p>;
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {message}
    </p>
  );
}

export function VegDot({ veg }: { veg: boolean }) {
  return (
    <span
      title={veg ? "Veg" : "Non-veg"}
      className={`inline-grid h-3.5 w-3.5 shrink-0 place-items-center rounded-sm border ${veg ? "border-green-600" : "border-red-600"}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${veg ? "bg-green-600" : "bg-red-600"}`} />
    </span>
  );
}

const STATUS_STYLE: Record<OrderStatus, string> = {
  pending_payment: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  placed: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  preparing: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  ready: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  completed: "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

export function StatusPill({ status }: { status: OrderStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Wraps pages that need a signed-in user (optionally with a given role). */
export function RequireAuth({ roles, children }: { roles?: UserRole[]; children: React.ReactNode }) {
  const { session, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) router.replace(`/login?next=${encodeURIComponent(location.pathname)}`);
  }, [loading, session, router]);

  if (loading || !session) return <Spinner />;
  if (roles && !profile) return <Spinner />;
  if (roles && profile && !roles.includes(profile.role)) {
    return (
      <div className="py-16 text-center">
        <p className="font-semibold">This page is only for {roles.join(" / ")} accounts.</p>
        <Link href="/" className="mt-3 inline-block text-brand underline">
          Back to stalls
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}

export function ConfigWarning() {
  if (supabaseConfigured) return null;
  return (
    <div className="bg-yellow-100 px-4 py-2 text-center text-sm text-yellow-900">
      Supabase is not configured — copy <code>web/.env.example</code> to <code>web/.env.local</code> and fill in
      your project URL and anon key.
    </div>
  );
}
