import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Orders' };

export default function Page() {
  return (
    <ComingSoon
      title="Orders"
      issue={24}
      description="Search every order, see its timeline and issue refunds."
    />
  );
}
