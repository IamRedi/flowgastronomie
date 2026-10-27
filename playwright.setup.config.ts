import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/setup",
  testMatch: "*.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 120000,
  use: {
    actionTimeout: 20000,
    baseURL: "http://localhost:3500",
    ...devices["Desktop Chrome"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "node node_modules/tsx/dist/cli.mjs tests/setup/acceptance-server.ts",
      url: "http://127.0.0.1:4300/health",
      timeout: 60000,
      reuseExistingServer: false,
      env: {
        SMART_SETUP_BROWSER_GATE: "true",
        MENU_IMPORT_PROVIDER: "disabled",
        WEB_ORIGIN: "http://localhost:3500",
      },
    },
    {
      command: "node node_modules/next/dist/bin/next dev apps/web -p 3500",
      url: "http://localhost:3500/en",
      timeout: 120000,
      reuseExistingServer: false,
      env: {
        NEXT_DIST_DIR: ".next-setup",
        NEXT_PUBLIC_API_URL: "http://localhost:4300",
        API_URL: "http://localhost:4300",
      },
    },
  ],
});
