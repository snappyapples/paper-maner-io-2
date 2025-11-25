import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/paper-maner-io-2',
  assetPrefix: '/paper-maner-io-2/',
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
