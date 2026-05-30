/** @type {import('next').NextConfig} */
// Normalise basePath: trim, ignore lone "/", and drop the leading slash if
// the env var doesn't start with one. Org pages (<name>.github.io) serve at
// the root, so basePath must be ''. Project pages need '/<repo>'.
const rawBase = (process.env.NEXT_PUBLIC_BASE_PATH || '').trim();
const basePath = rawBase && rawBase !== '/' ? (rawBase.startsWith('/') ? rawBase : `/${rawBase}`) : '';

const nextConfig = {
  // Static export → ships to GitHub Pages / Cloudflare Pages with no server.
  // Only enabled for production builds; `next dev` runs as a normal dev server
  // (the export mode interacts badly with dynamic routes when the project
  // path contains spaces).
  ...(process.env.NODE_ENV === 'production' ? { output: 'export' } : {}),
  images: { unoptimized: true },
  trailingSlash: true,
  basePath,
};

module.exports = nextConfig;
