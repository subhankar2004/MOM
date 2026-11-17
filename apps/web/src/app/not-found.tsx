import { SearchX } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center">
      <EmptyState
        icon={<SearchX size={40} aria-hidden />}
        title="This page doesn't exist"
        description="The link may be old or mistyped."
        action={<ButtonLink href="/">Go to stalls</ButtonLink>}
      />
    </main>
  );
}
