import type { Metadata } from 'next';
import { StallsList } from './stalls-list';

export const metadata: Metadata = { title: 'Stalls' };

export default function Page() {
  return <StallsList />;
}
