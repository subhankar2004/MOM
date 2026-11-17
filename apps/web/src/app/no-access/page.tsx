import { ShieldX } from 'lucide-react';
import type { Metadata } from 'next';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: 'No access', robots: { index: false } };

export default function NoAccessPage() {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-4">
      <EmptyState
        as="h1"
        icon={<ShieldX size={40} aria-hidden />}
        title="No access"
        description="Your account can't open that page. Stall owners are added by the MOM team; if you run a stall, ask them to register your number."
        action={<ButtonLink href="/">Go to stalls</ButtonLink>}
      />
    </main>
  );
}
