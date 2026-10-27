import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const next = require.resolve("next/dist/bin/next");
const options = {
  cwd: resolve("apps/web"),
  // e2e-run builds with Playwright's isolated API origin before this starts.
  env: { ...process.env, NODE_ENV: "production" },
  stdio: "inherit",
  windowsHide: true,
};
const server = spawn(
  process.execPath,
  [next, "start", "--port", "3300"],
  options,
);
server.on("error", (error) => {
  console.error(`E2E web server failed: ${error.code}`);
  process.exitCode = 1;
});
server.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}
