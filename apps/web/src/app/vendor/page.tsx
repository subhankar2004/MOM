import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Orders' };

export default function Page() {
  return (
    <ComingSoon
      title="Today's orders"
      issue={18}
      description="New, preparing and ready orders for your stall, live."
    />
  );
}
