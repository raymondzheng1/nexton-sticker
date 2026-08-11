/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Tier B / local-first PWA: no server rendering needs beyond the thin sync API routes.
};

export default nextConfig;
