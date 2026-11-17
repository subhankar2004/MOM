import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Settlements' };

export default function Page() {
  return (
    <ComingSoon
      title="Settlements"
      issue={26}
      description="What each stall has been paid and what it owes."
    />
  );
}
