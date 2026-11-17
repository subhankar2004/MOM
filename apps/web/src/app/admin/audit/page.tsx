import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Audit log' };

export default function Page() {
  return (
    <ComingSoon title="Audit log" issue={27} description="Every change made by admins and stall owners." />
  );
}
