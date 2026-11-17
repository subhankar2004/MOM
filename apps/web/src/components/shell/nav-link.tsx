'use client';

import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';
import { cn } from '@/lib/cn';

export interface NavItem {
  href: Route;
  label: string;
  icon: LucideIcon;
  /** Match only the exact path (for section roots like /vendor). */
  exact?: boolean;
}

export function useIsActive() {
  const pathname = usePathname();
  return (item: NavItem) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Bottom tab bar for phones. */
export function BottomNav({ items, label }: { items: NavItem[]; label: string }) {
  const isActive = useIsActive();
  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-lg">
        {items.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-16 flex-col items-center justify-center gap-0.5 text-xs font-semibold',
                  active ? 'text-ink' : 'text-ink-muted hover:text-ink',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-12 items-center justify-center rounded-full',
                    active && 'bg-haldi text-haldi-ink',
                  )}
                >
                  <Icon size={20} aria-hidden />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Vertical navigation for tablets/desktops (vendor rail, admin sidebar). */
export function SideNav({
  items,
  label,
  onNavigate,
}: {
  items: NavItem[];
  label: string;
  onNavigate?: () => void;
}) {
  const isActive = useIsActive();
  return (
    <nav aria-label={label}>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-11 items-center gap-3 rounded-(--radius-control) px-3 font-semibold transition-colors',
                  active ? 'bg-haldi text-haldi-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
                )}
              >
                <Icon size={20} aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
