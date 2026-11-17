import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { RequireRole } from '@/components/auth/require-role';
import { VendorShell } from '@/components/shell/vendor-shell';

export const metadata: Metadata = {
  title: { default: 'Stall console', template: '%s · Stall console · MOM' },
};

export default function VendorLayout({ children }: { children: ReactNode }) {
  return (
    <RequireRole area="vendor">
      <VendorShell>{children}</VendorShell>
    </RequireRole>
  );
}
