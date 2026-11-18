import type { Metadata } from 'next';
import { StallDetail } from './stall-detail';

export const metadata: Metadata = { title: 'Stall' };

export default function Page() {
  return <StallDetail />;
}
