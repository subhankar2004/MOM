import type { Metadata } from 'next';
import { RequireRole } from '@/components/auth/require-role';
import { OrderView } from './order-view';

export const metadata: Metadata = { title: 'Your order' };

export default function OrderPage() {
  return (
    <RequireRole area="student">
      <OrderView />
    </RequireRole>
  );
}
