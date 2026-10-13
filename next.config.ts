import type { NextConfig } from "next";

// cacheComponents (Next 16 Cache Components mode) is intentionally OFF:
// it forces a <Suspense> boundary around every Server Component that reads
// cookies() — which is every authenticated page in this app. The app is fully
// dynamic (auth-gained data), so PPR/partial prefetching buys nothing here.
// See docs/adr/0001-nextjs-app-router.md.
const nextConfig: NextConfig = {
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
