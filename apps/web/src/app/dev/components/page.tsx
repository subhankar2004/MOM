import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Showcase } from './showcase';

export const metadata: Metadata = { title: 'Components', robots: { index: false } };

/** Living style guide. Hidden in production unless SHOW_DEV_PAGES=1 (used for e2e/a11y checks). */
export default function ComponentsPage() {
  if (process.env.NODE_ENV === 'production' && process.env.SHOW_DEV_PAGES !== '1') notFound();
  return <Showcase />;
}
