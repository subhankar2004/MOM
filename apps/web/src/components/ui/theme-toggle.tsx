'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { applyTheme, readThemeChoice, subscribeThemeChoice, type ThemeChoice } from '@/lib/theme';
import { IconButton } from './icon-button';

const ORDER: ThemeChoice[] = ['system', 'light', 'dark'];
const META = {
  system: { icon: Monitor, label: 'Theme: follow device' },
  light: { icon: Sun, label: 'Theme: light' },
  dark: { icon: Moon, label: 'Theme: dark' },
};

/** Cycles device → light → dark. The choice is remembered on this device. */
export function ThemeToggle() {
  // Server render (and first client render) shows "system"; then the saved choice. No mismatch.
  const choice = useSyncExternalStore(subscribeThemeChoice, readThemeChoice, () => 'system' as const);
  const { icon: Icon, label } = META[choice];
  return (
    <IconButton
      label={`${label}. Change theme`}
      icon={<Icon size={20} aria-hidden />}
      onClick={() => applyTheme(ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]!)}
    />
  );
}
