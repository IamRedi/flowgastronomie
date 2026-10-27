import { defineConfig, devices } from "@playwright/test";

const webOrigin = "http://localhost:3300";
const apiOrigin = "http://localhost:4100";

// These browser journeys seed/write disposable data. Fail closed before the
// API starts if a hosted connection was inherited from a developer session.
const disposableDatabase = (() => {
  try {
    const database = new URL(process.env.DATABASE_URL ?? "");
    return (
      ["postgres:", "postgresql:"].includes(database.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) &&
      !["host", "hostaddr", "service", "servicefile"].some((key) =>
        database.searchParams.has(key),
      )
    );
  } catch {
    return false;
  }
})();
if (!disposableDatabase)
  throw new Error(
    "E2E requires an explicit disposable loopback PostgreSQL URL",
  );

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: webOrigin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "npm run start --workspace=@flowgastronomie/api",
      env: {
        ...process.env,
        API_PORT: "4100",
        HARDWARE_SIMULATOR_ENABLED: "true",
        WEB_ORIGIN: webOrigin,
        TRUST_PROXY: "127.0.0.1/32,::1/128",
      },
      url: "http://127.0.0.1:4100/health",
      // Never reuse an already-listening server: a foreign process on this
      // port would otherwise answer the readiness check and silently break
      // every test, so always start the servers this config owns.
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "node tests/operations/e2e-web-server.mjs",
      env: {
        ...process.env,
        API_URL: apiOrigin,
        NEXT_PUBLIC_API_URL: apiOrigin,
      },
      url: "http://127.0.0.1:3300",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
