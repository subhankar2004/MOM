import { Hammer } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

/** Placeholder for a screen whose issue hasn't been built yet. */
export function ComingSoon({
  title,
  issue,
  description,
}: {
  title: string;
  issue: number;
  description: string;
}) {
  return (
    <div>
      <h1 className="font-display text-3xl font-black">{title}</h1>
      <EmptyState
        icon={<Hammer size={36} aria-hidden />}
        title="Being built"
        description={`${description} Arrives with issue #${issue}.`}
      />
    </div>
  );
}
