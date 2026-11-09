import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Self-contained server bundle; built on GitHub Actions, run as-is on Hostinger.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Unmatched URLs get app/global-not-found.tsx: the app has two root layouts
  // ([locale] and admin), so there is no single layout to build a 404 from.
  experimental: { globalNotFound: true },
  // Baked into the server bundle so /api/health can report what is deployed.
  env: {
    BUILD_SHA: process.env.GITHUB_SHA ?? "dev",
    BUILD_TIME: process.env.BUILD_TIME ?? new Date().toISOString(),
  },
  // Backup for the hPanel/DNS-level redirect: one canonical hostname (see docs/deployment.md).
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.endzoneiq.com" }],
        destination: "https://endzoneiq.com/:path*",
        permanent: true,
      },
    ];
  },
  // The Python pipeline and docs are never part of the web build.
  outputFileTracingExcludes: {
    "*": ["./pipeline/**/*", "./docs/**/*", "./.github/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
