import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @mom/shared ships TypeScript source; Next compiles it with the app.
  transpilePackages: ['@mom/shared'],
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Camera is needed by the vendor QR scanner (#21); nothing else.
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
