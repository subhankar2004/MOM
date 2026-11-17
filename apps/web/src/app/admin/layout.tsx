import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AdminShell } from '@/components/shell/admin-shell';

export const metadata: Metadata = { title: { default: 'Admin', template: '%s · Admin · MOM' } };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
