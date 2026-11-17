'use client';

import type { FeeBreakdown } from '@mom/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import type { Cart } from './cart';

export interface CartQuote {
  stall: { id: string; slug: string; name: string; state: 'open' | 'paused' | 'closed' };
  lines: Array<{
    itemId: string;
    name: string | null;
    quantity: number;
    status: 'ok' | 'price_changed' | 'unavailable' | 'removed';
    unitPricePaise: number | null;
    previousPricePaise: number | null;
    lineTotalPaise: number;
  }>;
  subtotalPaise: number;
  rates: { platformFeeBps: number; cashFeeBps: number };
  options: { upi: FeeBreakdown | null; cash: FeeBreakdown | null };
  problems: Array<'stall_closed' | 'stall_paused' | 'no_payment_method' | 'items_need_attention' | 'empty'>;
  canCheckout: boolean;
}

/** The server's price check of the current cart; re-runs whenever the cart changes. */
export function useCartQuote(cart: Cart) {
  const items = cart.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, pricePaise: l.pricePaise }));
  return useQuery({
    queryKey: ['cart-quote', cart.stall?.id, items],
    queryFn: () =>
      apiRequest<CartQuote>('/v1/cart/quote', { method: 'POST', body: { stallId: cart.stall!.id, items } }),
    enabled: cart.stall !== null && items.length > 0,
    placeholderData: keepPreviousData, // keep the old bill on screen while re-pricing
    staleTime: 0,
    refetchInterval: 60_000,
  });
}
