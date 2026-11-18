import type { Metadata } from 'next';
import { MenuEditor } from './menu-editor';

export const metadata: Metadata = { title: 'Menu' };

export default function Page() {
  return <MenuEditor />;
}
