import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Menu' };

export default function StallMenuPage() {
  return <ComingSoon title="Menu" issue={12} description="The stall's dishes with photos and prices." />;
}
