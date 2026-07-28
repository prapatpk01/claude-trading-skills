/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // exceljs is a server-only dependency; keep it external so it isn't bundled for the client
  experimental: {
    serverComponentsExternalPackages: ["exceljs", "yahoo-finance2"],
  },
};

module.exports = nextConfig;
