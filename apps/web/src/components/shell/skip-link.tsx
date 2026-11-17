/** Lets keyboard users jump past the navigation. */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only z-50 rounded-(--radius-control) bg-brand px-4 py-2 font-semibold text-brand-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
    >
      Skip to content
    </a>
  );
}
