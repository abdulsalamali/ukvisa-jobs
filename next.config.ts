import type { NextConfig } from "next";

// GitHub Pages serves project sites from /<repo>/, so the base path is set at
// build time. A custom domain would leave it unset.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  // @libsql/client is only used at build time by the data export, but keeping
  // it external avoids bundling its native bindings.
  serverExternalPackages: ["@libsql/client"],
};

export default nextConfig;
