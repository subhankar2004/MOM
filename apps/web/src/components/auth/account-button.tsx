'use client';

import { UserRound } from 'lucide-react';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/button';
import { useSession } from '@/lib/session';

/** Header control: "Sign in" when signed out, the user's initial (→ profile) when signed in. */
export function AccountButton() {
  const { user, status } = useSession();
  if (status === 'loading') return <span className="size-11" aria-hidden />;
  if (!user) {
    return (
      <ButtonLink href="/login" size="sm" variant="secondary">
        Sign in
      </ButtonLink>
    );
  }
  const initial = user.name?.trim()[0]?.toUpperCase();
  return (
    <Link
      href="/profile"
      aria-label={`Your profile${user.name ? `, ${user.name}` : ''}`}
      className="flex size-11 items-center justify-center rounded-full"
    >
      <span className="flex size-9 items-center justify-center rounded-full bg-haldi font-display text-lg font-bold text-haldi-ink">
        {initial ?? <UserRound size={18} aria-hidden />}
      </span>
    </Link>
  );
}
