'use client';

import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center">
      <EmptyState
        icon={<TriangleAlert size={40} aria-hidden />}
        title="Something went wrong on this page"
        description={`Try again. If it keeps happening, share this code with MOM support: ${error.digest ?? 'unknown'}`}
        action={
          <Button onClick={reset} icon={<RefreshCw size={18} aria-hidden />}>
            Try again
          </Button>
        }
      />
    </main>
  );
}
