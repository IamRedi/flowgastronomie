import { build } from "esbuild";
import { resolve } from "node:path";

// Bundle our TypeScript workspaces; retain ordinary production package imports.
await build({
  entryPoints: {
    server: "apps/api/src/server.ts",
    "retention-run": "packages/database/src/run-operational-retention.ts",
    "retention-check": "packages/database/src/check-operational-retention.ts",
  },
  outdir: "dist/production",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  alias: {
    "@flowgastronomie/domain": resolve("packages/domain/src/index.ts"),
    "@flowgastronomie/database": resolve("packages/database/src/index.ts"),
  },
  logLevel: "info",
});
