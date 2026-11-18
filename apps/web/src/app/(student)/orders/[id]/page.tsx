import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireRole } from '@/components/auth/require-role';
import { OrderView } from './order-view';

export const metadata: Metadata = { title: 'Your order' };

export default function OrderPage() {
  return (
    <RequireRole area="student">
      {/* The payment panel reads ?pay=1 (Next 16: client URL reads need a Suspense boundary). */}
      <Suspense>
        <OrderView />
      </Suspense>
    </RequireRole>
  );
}
