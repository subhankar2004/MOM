import type { Metadata } from 'next';
import { RequireRole } from '@/components/auth/require-role';
import { CheckoutView } from './checkout-view';

export const metadata: Metadata = { title: 'Checkout' };

export default function CheckoutPage() {
  return (
    <RequireRole area="student">
      <CheckoutView />
    </RequireRole>
  );
}
