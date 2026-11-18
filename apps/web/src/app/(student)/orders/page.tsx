import type { Metadata } from 'next';
import { RequireRole } from '@/components/auth/require-role';
import { OrdersView } from './orders-view';

export const metadata: Metadata = { title: 'Your orders' };

export default function OrdersPage() {
  return (
    <RequireRole area="student">
      <OrdersView />
    </RequireRole>
  );
}
