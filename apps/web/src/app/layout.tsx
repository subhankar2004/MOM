import type { Metadata, Viewport } from 'next';
import { Big_Shoulders, Schibsted_Grotesk } from 'next/font/google';
import type { ReactNode } from 'react';
import { themeInitScript } from '@/lib/theme';
import { Providers } from './providers';
import './globals.css';

// Self-hosted at build time by next/font: no request to Google from the user's browser.
const body = Schibsted_Grotesk({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const display = Big_Shoulders({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-display-face',
  display: 'swap',
  // Next has no metrics for this family to build a size-matched fallback; use the body font's.
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: { default: 'MOM — order from campus stalls', template: '%s · MOM' },
  description:
    'Pre-order from the food stalls around VSSUT, pay by UPI or cash, and pick up with your token.',
  applicationName: 'MOM',
  appleWebApp: { capable: true, title: 'MOM', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#171b3d' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning className={`${body.variable} ${display.variable}`}>
      <head>
        {/* Sets light/dark before first paint (no flash). Static string, no user input. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
