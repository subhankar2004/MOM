import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Stalls' };

export default function Page() {
  return (
    <ComingSoon
      title="Stalls"
      issue={23}
      description="Add stalls and register their owners' phone numbers."
    />
  );
}
