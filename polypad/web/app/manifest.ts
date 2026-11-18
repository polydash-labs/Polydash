import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Polypad',
    short_name: 'Polypad',
    description: 'Launch, trade and stake tokens on Robinhood Chain.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0A0A0A',
    theme_color: '#0A0A0A',
    icons: [
      { src: '/icon-192.png?v=2', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png?v=2', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png?v=2', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
