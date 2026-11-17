import type { Metadata } from 'next';
import { RequireRole } from '@/components/auth/require-role';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Orders' };

export default function OrdersPage() {
  return (
    <RequireRole area="student">
      <ComingSoon
        title="Your orders"
        issue={17}
        description="Live status of today's orders and your past orders."
      />
    </RequireRole>
  );
}
