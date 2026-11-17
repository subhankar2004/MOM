import type { ReactNode } from 'react';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { Logo } from '@/components/ui/logo';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { SkipLink } from './skip-link';
import { StallSwitcher } from './stall-switcher';
import { VendorBottomNav, VendorSideNav } from './vendor-nav';

/** Stall console: side rail on tablets (the counter device), bottom bar on phones (spec §6.2). */
export function VendorShell({ children }: { children: ReactNode }) {
  return (
    <div className="md:flex">
      <SkipLink />
      <aside className="hidden w-60 shrink-0 flex-col gap-6 border-r border-border bg-surface p-4 md:sticky md:top-0 md:flex md:h-dvh">
        <Logo />
        <VendorSideNav />
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border bg-surface/95 px-4 backdrop-blur">
          <StallSwitcher />
          <div className="flex items-center">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl px-4 pt-4 pb-24 md:pb-8">
          {children}
        </main>
      </div>
      <div className="md:hidden">
        <VendorBottomNav />
      </div>
    </div>
  );
}
