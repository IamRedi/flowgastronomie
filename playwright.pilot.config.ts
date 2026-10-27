import { defineConfig, devices } from "@playwright/test";

const webOrigin = process.env.PILOT_WEB_ORIGIN ?? "http://localhost:3000";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(webOrigin).hostname))
  throw new Error("Pilot browser tests require a local server");

// Explicit local rehearsal only. Uses running dev servers; never a deployed URL.
export default defineConfig({
  testDir: "./tests/pilot",
  workers: 1,
  retries: 0,
  timeout: 90_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: webOrigin,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
