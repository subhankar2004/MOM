import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Revenue' };

export default function Page() {
  return <ComingSoon title="Revenue" issue={25} description="MOM's fee earnings by day and by stall." />;
}
