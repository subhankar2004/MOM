import type { Metadata } from 'next';
import { PlatformSettingsView } from './settings-view';

export const metadata: Metadata = { title: 'Settings' };

export default function Page() {
  return <PlatformSettingsView />;
}
