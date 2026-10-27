import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnCommandSync } from "./process-command.mjs";

const require = createRequire(import.meta.url);
// Build before Playwright's server-start deadline, using the isolated API URL.
const build = spawnCommandSync(
  process.execPath,
  [require.resolve("next/dist/bin/next"), "build"],
  {
    cwd: resolve("apps/web"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      API_URL: "http://localhost:4100",
      NEXT_PUBLIC_API_URL: "http://localhost:4100",
    },
    stdio: "inherit",
  },
);
if (build.status !== 0) process.exit(build.status ?? 1);
const tests = spawnCommandSync(
  process.execPath,
  [require.resolve("@playwright/test/cli"), "test", ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exitCode = tests.status ?? 1;
