import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/creative",
  workers: 1,
  retries: 0,
  timeout: 120000,
  use: {
    baseURL: "http://localhost:3400",
    ...devices["Desktop Chrome"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev apps/web -p 3400",
    url: "http://localhost:3400/en",
    timeout: 120000,
    reuseExistingServer: false,
    env: {
      NEXT_DIST_DIR: ".next-creative",
      NEXT_PUBLIC_API_URL: "http://localhost:4200",
      API_URL: "http://localhost:4200",
    },
  },
});
