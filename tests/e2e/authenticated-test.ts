import { test as base, expect, type BrowserContext } from "@playwright/test";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

// Operational tests exercise POS/hardware, not the login form. Reuse a real
// worker session so the suite respects the production login rate limit. Each
// test still receives its own browser context and a copy of this cookie state.
// critical-journeys.spec.ts continues to exercise UI login for every role/locale.
export const test = base.extend<{}, { managerStorageState: StorageState }>({
  managerStorageState: [
    async ({ playwright }, use) => {
      const auth = await playwright.request.newContext({
        baseURL: "http://localhost:4100",
      });
      try {
        const response = await auth.post("/v1/auth/login", {
          data: {
            tenantSlug: "flowgastronomie-demo",
            venueSlug: "restaurant-olive",
            email: "manager@flowgastronomie.local",
            password: "Demo1234!",
          },
        });
        expect(response.status()).toBe(200);
        await use(await auth.storageState());
      } finally {
        await auth.dispose();
      }
    },
    { scope: "worker" },
  ],
  storageState: async ({ managerStorageState }, use) => {
    await use(managerStorageState);
  },
});
