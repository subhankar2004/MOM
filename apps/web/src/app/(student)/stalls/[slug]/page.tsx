import type { Metadata } from 'next';
import { StallMenuView } from './stall-menu';

export const metadata: Metadata = { title: 'Menu' };

export default function StallMenuPage() {
  return <StallMenuView />;
}
