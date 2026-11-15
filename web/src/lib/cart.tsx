"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { MenuItem, Stall } from "./types";

export interface CartLine {
  item: MenuItem;
  quantity: number;
}

interface CartData {
  stall: Pick<Stall, "id" | "name"> | null;
  lines: Record<string, CartLine>;
}

interface CartState extends CartData {
  count: number;
  subtotal: number;
  /** Returns false if the item is from a different stall (caller should confirm + clear). */
  add: (stall: Pick<Stall, "id" | "name">, item: MenuItem) => boolean;
  remove: (itemId: string) => void;
  /** Discard the current cart and start one at a different stall. */
  startNew: (stall: Pick<Stall, "id" | "name">, item: MenuItem) => void;
  clear: () => void;
  quantityOf: (itemId: string) => number;
}

const KEY = "mom.cart.v1";
const EMPTY: CartData = { stall: null, lines: {} };
const CartContext = createContext<CartState | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<CartData>(EMPTY);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from storage
      if (raw) setData(JSON.parse(raw));
    } catch {
      /* storage unavailable — start empty */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }, [data, hydrated]);

  const value = useMemo<CartState>(() => {
    const lines = Object.values(data.lines);
    return {
      ...data,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      subtotal: lines.reduce((n, l) => n + l.quantity * l.item.price_paise, 0),
      add(stall, item) {
        if (data.stall && data.stall.id !== stall.id && lines.length > 0) return false;
        setData((d) => {
          const current = d.stall?.id === stall.id ? d.lines : {};
          const q = (current[item.id]?.quantity ?? 0) + 1;
          return { stall, lines: { ...current, [item.id]: { item, quantity: Math.min(q, 50) } } };
        });
        return true;
      },
      remove(itemId) {
        setData((d) => {
          const line = d.lines[itemId];
          if (!line) return d;
          const next = { ...d.lines };
          if (line.quantity <= 1) delete next[itemId];
          else next[itemId] = { ...line, quantity: line.quantity - 1 };
          return Object.keys(next).length ? { ...d, lines: next } : EMPTY;
        });
      },
      startNew: (stall, item) => setData({ stall, lines: { [item.id]: { item, quantity: 1 } } }),
      clear: () => setData(EMPTY),
      quantityOf: (itemId) => data.lines[itemId]?.quantity ?? 0,
    };
  }, [data]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
