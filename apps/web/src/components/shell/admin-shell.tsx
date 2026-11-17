'use client';

import {
  BadgeIndianRupee,
  FileClock,
  LayoutDashboard,
  Menu,
  ReceiptText,
  Settings2,
  Store,
  Users,
  Wallet,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { IconButton } from '@/components/ui/icon-button';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { Logo } from '@/components/ui/logo';
import { Sheet } from '@/components/ui/sheet';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { SideNav, type NavItem } from './nav-link';
import { SkipLink } from './skip-link';

const NAV: NavItem[] = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/revenue', label: 'Revenue', icon: BadgeIndianRupee },
  { href: '/admin/stalls', label: 'Stalls', icon: Store },
  { href: '/admin/users', label: 'Users & access', icon: Users },
  { href: '/admin/orders', label: 'Orders', icon: ReceiptText },
  { href: '/admin/settlements', label: 'Settlements', icon: Wallet },
  { href: '/admin/settings', label: 'Settings', icon: Settings2 },
  { href: '/admin/audit', label: 'Audit log', icon: FileClock },
];

/** Super-admin console: sidebar on desktop, menu sheet on smaller screens (spec §6.3). */
export function AdminShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="lg:flex">
      <SkipLink />
      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r border-border bg-surface p-4 lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-ink-muted">
            Admin
          </span>
        </div>
        <SideNav items={NAV} label="Admin" />
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border bg-surface/95 px-4 backdrop-blur">
          <div className="flex items-center gap-2 lg:hidden">
            <IconButton
              label="Open menu"
              icon={<Menu size={22} aria-hidden />}
              onClick={() => setMenuOpen(true)}
            />
            <Logo />
          </div>
          <span className="hidden font-semibold text-ink-muted lg:inline">MOM super admin</span>
          <div className="flex items-center">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl px-4 py-6">
          {children}
        </main>
      </div>
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Admin menu">
        <SideNav items={NAV} label="Admin" onNavigate={() => setMenuOpen(false)} />
      </Sheet>
    </div>
  );
}
