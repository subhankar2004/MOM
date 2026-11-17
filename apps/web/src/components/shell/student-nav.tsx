'use client';

import { Home, ReceiptText, UserRound } from 'lucide-react';
import { BottomNav, type NavItem } from './nav-link';

// Defined in a client module: icon components can't be passed from server to client components.
const NAV: NavItem[] = [
  { href: '/', label: 'Stalls', icon: Home, exact: true },
  { href: '/orders', label: 'Orders', icon: ReceiptText },
  { href: '/profile', label: 'Profile', icon: UserRound },
];

export function StudentNav() {
  return <BottomNav items={NAV} label="Main" />;
}
