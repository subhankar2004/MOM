import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Checkout' };

export default function CheckoutPage() {
  return <ComingSoon title="Checkout" issue={14} description="Choose UPI or cash and place your order." />;
}
