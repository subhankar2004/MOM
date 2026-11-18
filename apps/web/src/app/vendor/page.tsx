import type { Metadata } from 'next';
import { OrderBoard } from './order-board';

export const metadata: Metadata = { title: 'Orders' };

export default function Page() {
  return <OrderBoard />;
}
