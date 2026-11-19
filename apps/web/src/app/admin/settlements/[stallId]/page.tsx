import type { Metadata } from 'next';
import { StatementView } from './statement-view';

export const metadata: Metadata = { title: 'Statement' };

export default function Page() {
  return <StatementView />;
}
