import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Menu' };

export default function Page() {
  return (
    <ComingSoon
      title="Menu"
      issue={19}
      description="Add dishes with photos and prices, and mark items sold out."
    />
  );
}
