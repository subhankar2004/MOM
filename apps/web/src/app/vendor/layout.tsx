import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { VendorShell } from '@/components/shell/vendor-shell';

export const metadata: Metadata = {
  title: { default: 'Stall console', template: '%s · Stall console · MOM' },
};

export default function VendorLayout({ children }: { children: ReactNode }) {
  return <VendorShell>{children}</VendorShell>;
}
