import { useColorScheme } from 'react-native';

const light = {
  bg: '#fafaf9',
  surface: '#ffffff',
  text: '#1c1917',
  muted: '#78716c',
  border: '#e7e5e4',
  brand: '#ea580c',
  brandSoft: '#fff7ed',
  green: '#16a34a',
  red: '#dc2626',
};

const dark: typeof light = {
  bg: '#0c0a09',
  surface: '#1c1917',
  text: '#f5f5f4',
  muted: '#a8a29e',
  border: '#292524',
  brand: '#fb923c',
  brandSoft: '#2a1608',
  green: '#22c55e',
  red: '#f87171',
};

export type Palette = typeof light;

export function useColors(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}
