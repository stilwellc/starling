/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  // Board data is emitted to public/data/starling/*.json by the pipeline and
  // shipped as static files — no server routes.
  reactStrictMode: true,
};

module.exports = nextConfig;
