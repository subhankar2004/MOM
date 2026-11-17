'use client';

import { ClipboardList, IndianRupee, ScanLine, Settings, UtensilsCrossed } from 'lucide-react';
import { BottomNav, SideNav, type NavItem } from './nav-link';

const NAV: NavItem[] = [
  { href: '/vendor', label: 'Orders', icon: ClipboardList, exact: true },
  { href: '/vendor/scan', label: 'Scan', icon: ScanLine },
  { href: '/vendor/menu', label: 'Menu', icon: UtensilsCrossed },
  { href: '/vendor/sales', label: 'Sales', icon: IndianRupee },
  { href: '/vendor/settings', label: 'Settings', icon: Settings },
];

export function VendorSideNav() {
  return <SideNav items={NAV} label="Stall console" />;
}

export function VendorBottomNav() {
  return <BottomNav items={NAV} label="Stall console" />;
}
