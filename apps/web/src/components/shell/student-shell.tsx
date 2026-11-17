import Link from 'next/link';
import type { ReactNode } from 'react';
import { AccountButton } from '@/components/auth/account-button';
import { CartBar } from '@/components/food/cart-bar';
import { Logo } from '@/components/ui/logo';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { StudentNav } from './student-nav';
import { SkipLink } from './skip-link';

/** Student app frame: slim header, content column, bottom tab bar (spec §6.1). */
export function StudentShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <Link href="/" aria-label="MOM home">
            <Logo />
          </Link>
          <div className="flex items-center gap-1">
            <span className="hidden text-sm text-ink-muted sm:inline">VSSUT, Burla</span>
            <ThemeToggle />
            <AccountButton />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-2xl px-4 pt-4 pb-44">
        {children}
      </main>
      <CartBar />
      <StudentNav />
    </>
  );
}
