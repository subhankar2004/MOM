import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Settings' };

export default function Page() {
  return (
    <ComingSoon
      title="Platform settings"
      issue={27}
      description="Fees, cash-order limits and feature switches."
    />
  );
}
