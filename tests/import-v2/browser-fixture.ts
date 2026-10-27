import { createHash } from "node:crypto";
import { test as base, expect } from "@playwright/test";

export { expect, type Page } from "@playwright/test";

// Each independent synthetic browser is a distinct client. The fixture API
// trusts forwarding only from its loopback listener after the schema guard;
// application login/registration limits are neither raised nor disabled.
export const test = base.extend<{ isolatedClient: void }>({
  isolatedClient: [
    async ({ context }, use, testInfo) => {
      const bytes = createHash("sha256").update(testInfo.testId).digest();
      const address = `127.${bytes[0]}.${bytes[1]}.${bytes[2]}`;
      await context.setExtraHTTPHeaders({
        "x-forwarded-for": address,
      });
      const response = await context.request.get(
        "http://localhost:4302/fixture/client-address",
      );
      expect(response.status()).toBe(200);
      expect((await response.json()).ip).toBe(address);
      await use();
    },
    { auto: true },
  ],
});
