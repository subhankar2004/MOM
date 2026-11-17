'use client';

import { useSyncExternalStore } from 'react';

/**
 * The cart (spec §6.1 S4): one stall at a time, kept on this device (localStorage) so it
 * survives reloads, and shared live between open tabs. Prices here are what the student
 * saw; the server re-prices everything (POST /v1/cart/quote) before payment.
 */
export interface CartLine {
  itemId: string;
  name: string;
  pricePaise: number;
  isVeg?: boolean;
  quantity: number;
}

export interface Cart {
  stall: { id: string; slug: string; name: string } | null;
  lines: CartLine[];
  /** Note for the stall ("less spicy"), max 200 characters. */
  note: string;
}

export const MAX_QUANTITY = 20;
export const MAX_NOTE = 200;
const STORAGE_KEY = 'mom.cart.v1';
const EMPTY: Cart = Object.freeze({ stall: null, lines: [], note: '' }) as Cart;

function isCart(value: unknown): value is Cart {
  const c = value as Cart;
  return (
    typeof c === 'object' &&
    c !== null &&
    Array.isArray(c.lines) &&
    c.lines.every(
      (l) => typeof l.itemId === 'string' && Number.isInteger(l.quantity) && Number.isInteger(l.pricePaise),
    ) &&
    (c.stall === null || typeof c.stall?.id === 'string') &&
    typeof c.note === 'string'
  );
}

function load(): Cart {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return isCart(parsed) ? parsed : EMPTY; // anything unexpected (old format, tampering) → empty cart
  } catch {
    return EMPTY;
  }
}

let cart: Cart = load();
const listeners = new Set<() => void>();

function emit(next: Cart, persist = true) {
  cart = next.lines.length === 0 ? { ...EMPTY, note: '' } : next;
  if (persist) {
    try {
      if (cart.lines.length === 0) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    } catch {
      // storage full or blocked: the cart still works for this page
    }
  }
  listeners.forEach((l) => l());
}

// Another tab changed the cart → follow it.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) emit(load(), false);
  });
}

type StallRef = NonNullable<Cart['stall']>;
type ItemRef = Omit<CartLine, 'quantity'>;

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
  setQuantity(stall: StallRef, item: ItemRef, quantity: number): 'ok' | 'other-stall' {
    if (cart.stall && cart.stall.id !== stall.id && cart.lines.length > 0) return 'other-stall';
    const q = Math.max(0, Math.min(MAX_QUANTITY, Math.floor(quantity)));
    const existing = cart.lines.find((l) => l.itemId === item.itemId);
    const lines =
      q === 0
        ? cart.lines.filter((l) => l.itemId !== item.itemId)
        : existing
          ? cart.lines.map((l) => (l.itemId === item.itemId ? { ...l, ...item, quantity: q } : l))
          : [...cart.lines, { ...item, quantity: q }];
    emit({ stall: lines.length ? stall : null, lines, note: cart.note });
    return 'ok';
  },

  /** Empties the cart and starts a new one at `stall` with this item. */
  replaceWith(stall: StallRef, item: ItemRef, quantity: number) {
    emit(EMPTY);
    return cartStore.setQuantity(stall, item, quantity);
  },

  remove(itemId: string) {
    emit({ ...cart, lines: cart.lines.filter((l) => l.itemId !== itemId) });
  },

  /** Accept the server's current prices (after the student has seen the change). */
  acceptPrices(prices: Array<{ itemId: string; unitPricePaise: number }>) {
    emit({
      ...cart,
      lines: cart.lines.map((l) => {
        const p = prices.find((x) => x.itemId === l.itemId);
        return p ? { ...l, pricePaise: p.unitPricePaise } : l;
      }),
    });
  },

  setNote(note: string) {
    emit({ ...cart, note: note.slice(0, MAX_NOTE) });
  },

  clear: () => emit(EMPTY),
};

export function useCart(): Cart {
  return useSyncExternalStore(cartStore.subscribe, cartStore.get, () => EMPTY);
}

export function quantityIn(c: Cart, itemId: string): number {
  return c.lines.find((l) => l.itemId === itemId)?.quantity ?? 0;
}

export function cartTotals(c: Cart) {
  return {
    items: c.lines.reduce((n, l) => n + l.quantity, 0),
    subtotalPaise: c.lines.reduce((n, l) => n + l.quantity * l.pricePaise, 0),
  };
}
