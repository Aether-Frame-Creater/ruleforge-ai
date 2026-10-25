import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Kept out of the bundle and required at runtime instead.
   *
   * ADK reaches for optional peer dependencies it ships support for but does
   * not install — Mikro-ORM drivers, Google Cloud clients — and the bundler
   * cannot resolve code paths that will never run here. These are server-only
   * packages regardless, so bundling buys nothing.
   */
  serverExternalPackages: [
    "@google/adk",
    "@google/genai",
    "@neondatabase/serverless",
  ],
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
