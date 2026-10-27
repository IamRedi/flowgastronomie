import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  outputDir: "artifacts/import-v2/playwright",
  testDir: "./tests/import-v2",
  testMatch: "*.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 180000,
  expect: { timeout: 15000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3502",
    actionTimeout: 20000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "node node_modules/tsx/dist/cli.mjs tests/import-v2/acceptance-server.ts",
      url: "http://127.0.0.1:4302/health",
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        IMPORT_V2_BROWSER_GATE: "true",
        WEB_ORIGIN: "http://localhost:3502",
        MENU_IMPORT_PROVIDER: "disabled",
        BUSINESS_IMPORT_ALLOW_PAID_AI: "false",
      },
    },
    {
      command: "node node_modules/next/dist/bin/next dev apps/web -p 3502",
      url: "http://localhost:3502/en",
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        NEXT_DIST_DIR: ".next-import-v2",
        NEXT_PUBLIC_API_URL: "http://localhost:4302",
        API_URL: "http://localhost:4302",
      },
    },
  ],
});
