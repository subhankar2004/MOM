import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Orders' };

export default function OrdersPage() {
  return (
    <ComingSoon
      title="Your orders"
      issue={17}
      description="Live status of today's orders and your past orders."
    />
  );
}
