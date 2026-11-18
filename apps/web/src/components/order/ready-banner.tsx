import { CheckCircle2 } from 'lucide-react';

/**
 * The moment the student waits for: full-bleed green, impossible to miss at arm's length.
 * Announced politely to screen readers when it appears.
 */
export function ReadyBanner({ token, stallName }: { token: number | null; stallName: string }) {
  return (
    <section
      role="status"
      aria-live="polite"
      className="-mx-4 -mt-4 flex w-[calc(100%+2rem)] flex-col items-center gap-2 bg-success px-6 py-10 text-center text-white dark:text-[#06210f]"
    >
      <CheckCircle2 size={56} strokeWidth={2.25} aria-hidden />
      <h2 className="font-display text-4xl font-black">Ready to collect</h2>
      <p className="text-lg font-semibold">
        {token ? `Show token #${token} at ${stallName}` : `Collect it at ${stallName}`}
      </p>
    </section>
  );
}
