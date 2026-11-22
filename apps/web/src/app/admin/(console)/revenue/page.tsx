import type { Metadata } from 'next';
import { RevenueView } from './revenue-view';

export const metadata: Metadata = { title: 'Revenue' };

export default function Page() {
  return <RevenueView />;
}
