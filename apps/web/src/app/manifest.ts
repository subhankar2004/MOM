import type { MetadataRoute } from 'next';

/** Lets students "Add to home screen" and open MOM like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MOM — campus food pre-ordering',
    short_name: 'MOM',
    description: 'Order from the food stalls around VSSUT and pick up with your token.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f5f6fb',
    theme_color: '#2b3484',
    categories: ['food', 'shopping'],
    icons: [
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
