import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/premium",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: process.env.PREMIUM_WEB_URL ?? "http://127.0.0.1:3319",
    trace: "retain-on-failure",
  },
  webServer: process.env.PREMIUM_WEB_URL
    ? undefined
    : {
        command:
          "node node_modules/next/dist/bin/next start apps/web --hostname 127.0.0.1 --port 3319",
        url: "http://127.0.0.1:3319/en/showcase",
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
});
