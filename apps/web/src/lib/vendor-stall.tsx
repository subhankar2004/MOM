'use client';

import { useQuery } from '@tanstack/react-query';
import { Store } from 'lucide-react';
import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { apiRequest } from './api-client';

export interface VendorStall {
  id: string;
  slug: string;
  name: string;
  status: 'draft' | 'active' | 'suspended';
  memberRole: 'owner' | 'staff' | null;
}

const STORAGE_KEY = 'mom.vendor.stall';
const EVENT = 'mom:vendor-stall';

function readSelected(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function selectStall(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // storage blocked: the choice lasts until reload
  }
  window.dispatchEvent(new Event(EVENT));
}

interface VendorStallContext {
  stalls: VendorStall[];
  current: VendorStall;
}

const Ctx = createContext<VendorStallContext | null>(null);

/**
 * Loads the stalls this account may manage (GET /v1/vendor/stalls) and remembers which one
 * is selected on this device. Every stall-console page works on `useCurrentStall()`.
 */
export function VendorStallProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ['vendor', 'stalls'],
    queryFn: () => apiRequest<{ stalls: VendorStall[] }>('/v1/vendor/stalls'),
  });
  const saved = useSyncExternalStore(subscribe, readSelected, () => null);
  const stalls = query.data?.stalls;
  const value = useMemo(() => {
    if (!stalls?.length) return null;
    return { stalls, current: stalls.find((s) => s.id === saved) ?? stalls[0]! };
  }, [stalls, saved]);

  if (query.isPending) {
    return (
      <div className="flex justify-center py-16 text-ink-muted">
        <Spinner size={28} label="Loading your stalls" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        title="Can't load your stalls"
        description="Check your internet connection, then try again."
        action={<Button onClick={() => query.refetch()}>Try again</Button>}
      />
    );
  }
  if (!value) {
    return (
      <EmptyState
        icon={<Store size={36} aria-hidden />}
        title="No stall linked yet"
        description="Your account isn't connected to a stall. Ask the MOM team to register your number for your stall."
      />
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrentStall(): VendorStallContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCurrentStall must be used inside <VendorStallProvider>');
  return ctx;
}
