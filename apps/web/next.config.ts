import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  ...(process.env.OPERATIONS_LAB_ENABLED === "true"
    ? { logging: false as const }
    : {}),
  ...(process.env.OPERATIONS_LAB_BACKGROUND_WEB === "true"
    ? {}
    : { output: "standalone" as const }),
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  reactStrictMode: true,
  // Keep the local development indicator clear of the shared sidebar profile.
  devIndicators: { position: "bottom-right" },
  transpilePackages: ["@flowgastronomie/domain"],
  // Prerendering the full four-locale workspace concurrently can make the
  // React server renderer unstable in constrained CI containers. One worker
  // keeps the release build deterministic; deployment can raise this only
  // after proving the same gate reliably under its resource limits.
  experimental: { cpus: 1 },
};

export default nextConfig;
