import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/workforce-wf4",
  testMatch: "*.spec.ts",
  outputDir: "artifacts/workforce-wf4/playwright",
  workers: 1,
  retries: 0,
  timeout: 180000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3606",
    actionTimeout: 20000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "node node_modules/tsx/dist/cli.mjs tests/workforce-wf4/acceptance-server.ts",
      url: "http://127.0.0.1:4406/health",
      timeout: 900000,
      reuseExistingServer: false,
      env: {
        WORKFORCE_WF4_GATE: "true",
        WEB_ORIGIN: "http://localhost:3606",
        TRANSACTIONAL_EMAIL_PROVIDER: "disabled",
      },
    },
    {
      command: "node node_modules/next/dist/bin/next dev apps/web -p 3606",
      url: "http://localhost:3606/en",
      timeout: 120000,
      reuseExistingServer: false,
      env: {
        NEXT_DIST_DIR: ".next-workforce-wf4",
        NEXT_PUBLIC_API_URL: "http://localhost:4406",
        API_URL: "http://localhost:4406",
      },
    },
  ],
});
