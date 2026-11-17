import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Overview' };

export default function Page() {
  return (
    <ComingSoon
      title="Overview"
      issue={25}
      description="Today's orders, sales and MOM's earnings at a glance."
    />
  );
}
