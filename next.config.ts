import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // Stops `next dev` writing AGENTS.md and CLAUDE.md into the repo root.
  agentRules: false,
  // The dev badge covers the sidebar footer.
  devIndicators: false,
};

export default nextConfig;
