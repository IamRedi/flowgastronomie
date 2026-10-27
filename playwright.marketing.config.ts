import { defineConfig, devices } from "@playwright/test";

const externalOrigin = process.env.FLOW_MARKETING_TEST_ORIGIN;
if (externalOrigin && externalOrigin !== "http://127.0.0.1:3319") {
  throw new Error(
    "Only the dedicated loopback staging-image tunnel is allowed",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "marketing-foundation.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: externalOrigin ?? "http://127.0.0.1:3317",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: externalOrigin
    ? undefined
    : {
        command:
          "npm run start --workspace=@flowgastronomie/web -- --port 3317 --hostname 127.0.0.1",
        url: "http://127.0.0.1:3317",
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
