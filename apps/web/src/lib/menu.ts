'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import type { PublicStall } from './stalls';

export interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  pricePaise: number;
  isVeg: boolean;
  imageUrl: string | null;
  /** false = sold out */
  available: boolean;
}

export interface MenuCategory {
  id: string;
  name: string;
  items: MenuItem[];
}

export interface StallMenu {
  stall: PublicStall & { hours: Array<{ weekday: number; opensAt: string; closesAt: string }> };
  categories: MenuCategory[];
}

export function useStallMenu(slug: string) {
  return useQuery({
    queryKey: ['menu', slug],
    queryFn: () => apiRequest<StallMenu>(`/v1/stalls/${encodeURIComponent(slug)}/menu`),
    refetchInterval: 60_000, // open/closed and sold-out changes
    staleTime: 15_000,
  });
}
