'use client';

import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { canAccess, type Area } from '@/lib/roles';
import { useSession } from '@/lib/session';

/**
 * Shows its children only to signed-in users allowed in `area`:
 * signed out → that area's sign-in page (/login, /vendor/login or /admin/login) with ?next=<this
 * page>; wrong role → /no-access.
 * UX only — the API enforces the same rules on every request.
 */
export function RequireRole({ area, children }: { area: Area; children: ReactNode }) {
  const { user, status, retry } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const allowed = user ? canAccess(area, user.role) : false;

  useEffect(() => {
    if (status === 'signed-out') {
      const login = area === 'vendor' ? '/vendor/login' : area === 'admin' ? '/admin/login' : '/login';
      router.replace(`${login}?next=${encodeURIComponent(pathname)}` as Route);
    } else if (status === 'signed-in' && !allowed) {
      router.replace(`/no-access?from=${encodeURIComponent(pathname)}` as Route);
    }
  }, [status, allowed, pathname, router, area]);

  if (status === 'error') {
    return (
      <EmptyState
        title="Can't reach MOM right now"
        description="Check your internet connection, then try again."
        action={<Button onClick={() => retry()}>Try again</Button>}
      />
    );
  }
  if (status !== 'signed-in' || !allowed) {
    return (
      <div className="flex justify-center py-16 text-ink-muted">
        <Spinner size={28} label="Checking your account" />
      </div>
    );
  }
  return <>{children}</>;
}
