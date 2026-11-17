import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Settings' };

export default function Page() {
  return (
    <ComingSoon
      title="Stall settings"
      issue={20}
      description="Opening hours, prep time and the payment methods you accept."
    />
  );
}
