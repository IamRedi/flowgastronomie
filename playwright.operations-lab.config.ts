import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/operations-lab",
  workers: 1,
  retries: 0,
  timeout: 300000,
  outputDir: "artifacts/operations-lab/browser",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "artifacts/operations-lab/browser-acceptance.json" },
    ],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3400",
    navigationTimeout: 180000,
    actionTimeout: 60000,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  webServer: {
    command: "node tools/operations-lab/command.mjs web",
    url: "http://127.0.0.1:3400/en",
    reuseExistingServer:
      process.env.OPERATIONS_LAB_EXTERNAL_WEB === "true" || !process.env.CI,
    timeout: 180000,
    env: {
      NEXT_DIST_DIR: ".next-operations-lab",
      API_URL: "http://127.0.0.1:4400",
    },
  },
});
