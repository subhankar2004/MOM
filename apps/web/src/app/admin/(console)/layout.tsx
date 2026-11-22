import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { RequireRole } from '@/components/auth/require-role';
import { AdminShell } from '@/components/shell/admin-shell';

export const metadata: Metadata = { title: { default: 'Admin', template: '%s · Admin · MOM' } };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireRole area="admin">
      <AdminShell>{children}</AdminShell>
    </RequireRole>
  );
}
