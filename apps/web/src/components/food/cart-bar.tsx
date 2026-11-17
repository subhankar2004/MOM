'use client';

import { formatINR } from '@mom/shared';
import { ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cartTotals, useCart } from '@/lib/cart';

/** "3 items · ₹180 — View cart", floating above the tab bar while the cart has something. */
export function CartBar() {
  const cart = useCart();
  const pathname = usePathname();
  const { items, subtotalPaise } = cartTotals(cart);
  if (items === 0 || pathname === '/cart' || pathname.startsWith('/checkout')) return null;
  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 px-4 pb-2">
      <Link
        href="/cart"
        className="mx-auto flex max-w-lg items-center justify-between gap-3 rounded-(--radius-card) bg-brand px-4 py-3 text-brand-ink shadow-lg"
      >
        <span className="flex min-w-0 flex-col">
          <span className="tabular font-bold">
            {items} {items === 1 ? 'item' : 'items'} · {formatINR(subtotalPaise, { compact: true })}
          </span>
          <span className="truncate text-sm opacity-90">from {cart.stall?.name}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 font-bold">
          <ShoppingBag size={18} aria-hidden /> View cart
        </span>
      </Link>
    </div>
  );
}
