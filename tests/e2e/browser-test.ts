import { createHash } from "node:crypto";
import { test as base } from "@playwright/test";

export {
  expect,
  type Page,
  type BrowserContext,
  type Locator,
} from "@playwright/test";

// Independent synthetic customers must not share one login/rate-limit bucket.
// Only this suite's loopback API trusts these headers (playwright.config.ts).
// Production policies and application proxy configuration remain unchanged.
export const test = base.extend<{ isolatedClient: void }>({
  isolatedClient: [
    async ({ context }, use, testInfo) => {
      const bytes = createHash("sha256").update(testInfo.testId).digest();
      // Reserve 127.0.* for the worker API fixture and 127.255.* for the
      // explicit rate-limit regression; browser identities use 127.1–254.*.
      const address = `127.${(bytes[0]! % 254) + 1}.${bytes[1]}.${bytes[2]}`;
      await context.setExtraHTTPHeaders({ "x-forwarded-for": address });
      await use();
    },
    { auto: true },
  ],
});
