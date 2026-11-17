import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Sales' };

export default function Page() {
  return (
    <ComingSoon title="Sales" issue={22} description="Today's sales, UPI and cash, and fees due to MOM." />
  );
}
