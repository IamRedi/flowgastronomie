import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/workforce",
  testMatch: "*.spec.ts",
  outputDir: "artifacts/workforce/playwright",
  workers: 1,
  retries: 0,
  timeout: 180000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3603",
    actionTimeout: 20000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "node node_modules/tsx/dist/cli.mjs tests/workforce/acceptance-server.ts",
      url: "http://127.0.0.1:4403/health",
      timeout: 120000,
      reuseExistingServer: false,
      env: {
        WORKFORCE_BROWSER_GATE: "true",
        WEB_ORIGIN: "http://localhost:3603",
        TRANSACTIONAL_EMAIL_PROVIDER: "disabled",
      },
    },
    {
      command: "node node_modules/next/dist/bin/next dev apps/web -p 3603",
      url: "http://localhost:3603/en",
      timeout: 120000,
      reuseExistingServer: false,
      env: {
        NEXT_DIST_DIR: ".next-workforce",
        NEXT_PUBLIC_API_URL: "http://localhost:4403",
        API_URL: "http://localhost:4403",
      },
    },
  ],
});
