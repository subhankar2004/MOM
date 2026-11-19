import type { Metadata } from 'next';
import { OrdersExplorer } from './orders-explorer';

export const metadata: Metadata = { title: 'Orders' };

export default function Page() {
  return <OrdersExplorer />;
}
