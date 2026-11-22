import type { MeResponse } from '@mom/shared';
import type { Route } from 'next';

export type Role = MeResponse['user']['role'];
export type Area = 'student' | 'vendor' | 'admin';

/**
 * Who may open which part of the web app. This only shapes the UI: the API checks
 * every request itself (spec §3), so hiding a page is never the security boundary.
 */
const ACCESS: Record<Area, readonly Role[]> = {
  student: ['student', 'vendor_owner', 'vendor_staff', 'super_admin'],
  vendor: ['vendor_owner', 'vendor_staff', 'super_admin'],
  admin: ['super_admin'],
};

export function canAccess(area: Area, role: Role): boolean {
  return ACCESS[area].includes(role);
}

/** Where each role lands after signing in when there's no page to go back to. */
export function homeFor(role: Role): Route {
  if (role === 'super_admin') return '/admin';
  if (role === 'vendor_owner' || role === 'vendor_staff') return '/vendor';
  return '/';
}

/**
 * Only same-site paths are allowed as a "go back to" target: "/orders" yes,
 * "https://evil.example", "//evil.example" or "/\evil.example" no (open-redirect protection).
 */
export function safeNextPath(next: string | null | undefined): Route | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if ([...next].some((ch) => ch.charCodeAt(0) < 32) || isLoginPage(next)) return null;
  return next as Route;
}

/** The three sign-in pages (never a "go back to" target: that would loop). */
function isLoginPage(path: string): boolean {
  const p = path.split(/[?#]/)[0]!;
  return p === '/login' || p === '/vendor/login' || p === '/admin/login' || p.startsWith('/login/');
}
