import type { Metadata } from 'next';
import { SettlementsList } from './settlements-list';

export const metadata: Metadata = { title: 'Settlements' };

export default function Page() {
  return <SettlementsList />;
}
