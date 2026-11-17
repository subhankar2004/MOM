import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Scan' };

export default function Page() {
  return (
    <ComingSoon
      title="Scan a token"
      issue={21}
      description="Scan the student's QR code or type the token and pickup code."
    />
  );
}
