'use client';

import { LogOut } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { useSignOut } from '@/lib/session';

export function SignOutButton() {
  const signOut = useSignOut('/login');
  return (
    <IconButton
      label="Sign out"
      icon={<LogOut size={20} aria-hidden />}
      disabled={signOut.isPending}
      onClick={() => signOut.mutate()}
    />
  );
}
