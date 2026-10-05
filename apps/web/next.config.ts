import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  transpilePackages: ['@invariant-trail/contracts', '@invariant-trail/engine'],
};

export default config;
