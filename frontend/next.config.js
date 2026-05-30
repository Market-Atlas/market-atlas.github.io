/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export → ships to GitHub Pages / Cloudflare Pages with no server.
  // Only enabled for production builds; `next dev` runs as a normal dev server
  // (the export mode interacts badly with dynamic routes when the project
  // path contains spaces).
  ...(process.env.NODE_ENV === 'production' ? { output: 'export' } : {}),
  images: { unoptimized: true },
  trailingSlash: true,
  // Set NEXT_PUBLIC_BASE_PATH=/Market_screener when deploying to GitHub Pages
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
};

module.exports = nextConfig;
