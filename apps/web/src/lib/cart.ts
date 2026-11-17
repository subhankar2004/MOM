'use client';

import { useSyncExternalStore } from 'react';

/**
 * The cart: one stall at a time (spec §6.1 S4). A tiny external store so every screen sees
 * the same cart without a provider. Saving across reloads, the cart bar and server-side
 * pricing arrive in #13.
 */
export interface CartLine {
  itemId: string;
  name: string;
  pricePaise: number;
  quantity: number;
}

export interface Cart {
  stall: { id: string; slug: string; name: string } | null;
  lines: CartLine[];
}

export const MAX_QUANTITY = 20;

let cart: Cart = { stall: null, lines: [] };
const listeners = new Set<() => void>();

function emit(next: Cart) {
  cart = next;
  listeners.forEach((l) => l());
}

export const cartStore = {
  get: () => cart,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /**
   * Sets an item's quantity (0 removes it). Returns 'other-stall' without changing anything
   * when the cart belongs to a different stall — the caller asks before replacing it.
   */
  setQuantity(
    stall: NonNullable<Cart['stall']>,
    item: Omit<CartLine, 'quantity'>,
    quantity: number,
  ): 'ok' | 'other-stall' {
    if (cart.stall && cart.stall.id !== stall.id && cart.lines.length > 0) return 'other-stall';
    const q = Math.max(0, Math.min(MAX_QUANTITY, Math.floor(quantity)));
    const others = cart.lines.filter((l) => l.itemId !== item.itemId);
    const existing = cart.lines.find((l) => l.itemId === item.itemId);
    const lines =
      q === 0
        ? others
        : existing
          ? cart.lines.map((l) => (l.itemId === item.itemId ? { ...l, ...item, quantity: q } : l))
          : [...cart.lines, { ...item, quantity: q }];
    emit({ stall: lines.length ? stall : null, lines });
    return 'ok';
  },

  /** Empties the cart and starts a new one at `stall` with this item. */
  replaceWith(stall: NonNullable<Cart['stall']>, item: Omit<CartLine, 'quantity'>, quantity: number) {
    emit({ stall: null, lines: [] });
    return cartStore.setQuantity(stall, item, quantity);
  },

  clear: () => emit({ stall: null, lines: [] }),
};

const serverCart: Cart = { stall: null, lines: [] };

export function useCart(): Cart {
  return useSyncExternalStore(cartStore.subscribe, cartStore.get, () => serverCart);
}

export function quantityIn(c: Cart, itemId: string): number {
  return c.lines.find((l) => l.itemId === itemId)?.quantity ?? 0;
}
