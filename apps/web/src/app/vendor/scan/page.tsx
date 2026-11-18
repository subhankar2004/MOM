import type { Metadata } from 'next';
import { ScanView } from './scan-view';

export const metadata: Metadata = { title: 'Scan' };

export default function Page() {
  return <ScanView />;
}
