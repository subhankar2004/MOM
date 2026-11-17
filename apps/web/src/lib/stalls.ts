'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api-client';

/** One stall as returned by GET /v1/stalls (dates still ISO strings from JSON). */
export interface PublicStall {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  location: string | null;
  photoUrl: string | null;
  cuisineTags: string[];
  isVegOnly: boolean;
  availability: {
    state: 'open' | 'paused' | 'closed';
    reason: 'hours' | 'override' | 'paused' | 'inactive';
    closesAt: string | null;
    nextOpensAt: string | null;
  };
  congestion: { level: 'low' | 'moderate' | 'busy'; waitMinutes: number };
  payments: { upi: boolean; cash: boolean };
  startingPricePaise: number | null;
  dishes: string[];
}

/** Until live updates arrive (#17), the list is refreshed every 30 seconds. */
export const STALLS_REFRESH_MS = 30_000;

export function useStalls() {
  return useQuery({
    queryKey: ['stalls'],
    queryFn: () => apiRequest<{ stalls: PublicStall[] }>('/v1/stalls'),
    select: (data) => data.stalls,
    refetchInterval: STALLS_REFRESH_MS,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });
}

/** Lowercase, accent- and space-insensitive text for matching ("Rava  Dosa" ~ "rava dosa"). */
export const normalize = (text: string) =>
  text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();

/** Does the stall match the search, and which of its dishes matched? */
export function matchStall(stall: PublicStall, query: string): { matches: boolean; dishes: string[] } {
  const q = normalize(query);
  if (!q) return { matches: true, dishes: [] };
  const inStall = [stall.name, ...stall.cuisineTags, stall.location ?? ''].some((t) =>
    normalize(t).includes(q),
  );
  const dishes = stall.dishes.filter((d) => normalize(d).includes(q));
  return { matches: inStall || dishes.length > 0, dishes };
}
