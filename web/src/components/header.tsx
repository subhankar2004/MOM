"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";

export function Header() {
  const { session, profile, signOut } = useAuth();
  const { count } = useCart();

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white">M</span>
          MOM
        </Link>
        <nav className="ml-auto flex items-center gap-1 text-sm font-medium">
          {profile?.role === "admin" && (
            <Link className="rounded-lg px-3 py-2 hover:bg-brand-soft" href="/admin">
              Admin
            </Link>
          )}
          {(profile?.role === "vendor" || profile?.role === "admin") && (
            <Link className="rounded-lg px-3 py-2 hover:bg-brand-soft" href="/vendor">
              My stall
            </Link>
          )}
          {session && (
            <Link className="rounded-lg px-3 py-2 hover:bg-brand-soft" href="/orders">
              Orders
            </Link>
          )}
          <Link className="relative rounded-lg px-3 py-2 hover:bg-brand-soft" href="/cart">
            Cart
            {count > 0 && (
              <span className="ml-1 rounded-full bg-brand px-1.5 py-0.5 text-xs text-white">{count}</span>
            )}
          </Link>
          {session ? (
            <button className="rounded-lg px-3 py-2 text-muted hover:bg-brand-soft" onClick={signOut}>
              Sign out
            </button>
          ) : (
            <Link className="btn-primary ml-1 py-2" href="/login">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
