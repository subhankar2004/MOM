import { describe, expect, it } from 'vitest';
import { canAccess, homeFor, safeNextPath } from './roles';

describe('canAccess', () => {
  it.each([
    ['student', 'student', true],
    ['student', 'vendor', false],
    ['student', 'admin', false],
    ['vendor_owner', 'vendor', true],
    ['vendor_staff', 'vendor', true],
    ['vendor_owner', 'admin', false],
    ['super_admin', 'admin', true],
    ['super_admin', 'vendor', true],
    ['super_admin', 'student', true],
  ] as const)('%s → %s: %s', (role, area, expected) => {
    expect(canAccess(area, role)).toBe(expected);
  });
});

describe('homeFor', () => {
  it('sends each role to its own area', () => {
    expect(homeFor('student')).toBe('/');
    expect(homeFor('vendor_owner')).toBe('/vendor');
    expect(homeFor('vendor_staff')).toBe('/vendor');
    expect(homeFor('super_admin')).toBe('/admin');
  });
});

describe('safeNextPath (open-redirect protection)', () => {
  it.each(['/orders', '/vendor/menu', '/stalls/dosa-corner?tab=menu'])('allows %s', (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    null,
    undefined,
    '',
    'orders',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    '/login',
    '/login?next=/admin',
    '/vendor/login',
    '/admin/login?next=/admin',
    '/orders\n',
    '/a\u0000b',
  ])('refuses %j', (path) => {
    expect(safeNextPath(path)).toBeNull();
  });
});
