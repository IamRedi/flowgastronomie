import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, country: "DE" | "AL") {
  const identity = {
    tenantId: country,
    venueId: `venue-${country}`,
    email: "waiter@demo.invalid",
    role: "WAITER",
    displayName: "Synthetic waiter",
    venueName: `Pilot ${country}`,
    tenantKind: "REAL",
  };
  await page.route("**/v1/staff/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/staff/me")
      return route.fulfill({ json: { staff: identity } });
    if (path === "/v1/staff/shift")
      return route.fulfill({ json: { shift: { id: "shift" } } });
    if (path === "/v1/staff/pos/menu")
      return route.fulfill({
        json: {
          venue: {
            id: identity.venueId,
            name: identity.venueName,
            currency: country === "DE" ? "EUR" : "ALL",
          },
          tables: [{ id: "table", label: "1", area: null }],
          categories: [
            {
              id: "pizza",
              name: "Pizza",
              products: [
                {
                  id: "pizza-1",
                  name: "Pizza Ã« Ã§ Ã„ Ã– Ãœ",
                  description: null,
                  priceMinor: 950,
                  currency: country === "DE" ? "EUR" : "ALL",
                  available: true,
                  station: "KITCHEN",
                  allergens: [],
                  variants: [],
                  modifierGroups: [],
                },
              ],
            },
          ],
        },
      });
    if (path === "/v1/staff/register")
      return route.fulfill({ json: { session: null, history: [] } });
    if (path.endsWith("/hardware/devices"))
      return route.fulfill({
        json: { devices: [], canManage: false, canDrawer: false },
      });
    if (route.request().method() !== "GET")
      throw new Error(`Unexpected mutation: ${path}`);
    return route.fulfill({ json: [] });
  });
  return identity;
}
for (const country of ["DE", "AL"] as const) {
  const locale = country === "DE" ? "de" : "sq";
  test(`recover frozen ${country} order after lost response and reload without changing its retry identity`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: country === "DE" ? 1024 : 360,
      height: 844,
    });
    await fixture(page, country);
    const submissions: Array<{ key: string; body: unknown }> = [];
    let reject = true;
    await page.route("**/v1/staff/orders", async (route) => {
      if (route.request().method() !== "POST")
        return route.fulfill({ json: [] });
      submissions.push({
        key: route.request().headers()["idempotency-key"]!,
        body: route.request().postDataJSON(),
      });
      if (reject) return route.abort("connectionfailed");
      return route.fulfill({
        json: {
          id: "same-committed-order",
          totalMinor: 950,
          currency: "EUR",
          tableLabel: null,
        },
      });
    });
    await page.goto(`/${locale}/staff/pos`);
    await page.locator(".pos-product").click();
    await page
      .getByRole("dialog")
      .locator(".pos-config-actions button")
      .last()
      .click();
    await expect(page.locator(".pos-cart-lines li")).toHaveCount(1);
    await page.reload();
    await expect(page.locator(".pos-cart-lines li")).toHaveCount(1);
    expect(submissions).toHaveLength(0);
    await page.locator(".pos-submit").click();
    await expect(page.locator(".pos-clear")).toBeDisabled();
    await expect(page.locator(".pos-product")).toBeDisabled();
    await page.reload();
    await expect(page.locator(".pos-cart-lines li")).toHaveCount(1);
    await expect(
      page.locator(".pos-line-actions button").first(),
    ).toBeDisabled();
    expect(submissions).toHaveLength(1);
    reject = false;
    await page.locator(".pos-submit").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toEqual(submissions[0]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `artifacts/recovery-${country}.png` });
  });
}
test("another tenant or employee cannot see the saved basket", async ({
  page,
}) => {
  await fixture(page, "DE");
  await page.goto("/de/staff/pos");
  await page.locator(".pos-product").click();
  await page
    .getByRole("dialog")
    .locator(".pos-config-actions button")
    .last()
    .click();
  await expect(page.locator(".pos-cart-lines li")).toHaveCount(1);
  await page.route("**/v1/staff/me", (route) =>
    route.fulfill({
      json: {
        staff: {
          tenantId: "AL",
          venueId: "venue-AL",
          email: "waiter@demo.invalid",
          role: "WAITER",
          displayName: "Another waiter",
          venueName: "AL",
          tenantKind: "REAL",
        },
      },
    }),
  );
  await page.reload();
  await expect(page.locator(".pos-product")).toBeVisible();
  await expect(page.locator(".pos-cart-lines li")).toHaveCount(0);
  await page.route("**/v1/staff/me", (route) =>
    route.fulfill({
      json: {
        staff: {
          tenantId: "DE",
          venueId: "venue-DE",
          email: "other@demo.invalid",
          role: "WAITER",
          displayName: "Another employee",
          venueName: "DE",
          tenantKind: "REAL",
        },
      },
    }),
  );
  await page.reload();
  await expect(page.locator(".pos-product")).toBeVisible();
  await expect(page.locator(".pos-cart-lines li")).toHaveCount(0);
});

test("receipt layouts retain the finalized totals at 58 and 80 mm", async ({
  page,
}) => {
  await fixture(page, "AL");
  const receipt = {
    id: "receipt",
    number: "R-TEST",
    status: "FINALIZED",
    issuedAt: "2026-10-14T12:00:00Z",
    grossMinor: 180000,
    netMinor: 150000,
    taxMinor: 30000,
    currency: "ALL",
    method: "CASH",
    receivedMinor: 200000,
    changeMinor: 20000,
    business: {
      legalName: "Pica ë ç Ä Ö Ü",
      venueName: "Pilot",
      addressLine1: "Test 1",
      postalCode: "1001",
      city: "Tiranë",
      countryCode: "AL",
      vatId: null,
    },
    cashier: { displayName: "Synthetic waiter" },
    items: [
      {
        quantity: 2,
        productName: "Pica ë ç",
        variantName: "E madhe",
        modifiers: [],
        grossMinor: 180000,
      },
    ],
    breakdown: [
      {
        taxCode: "TEST",
        rateBasisPoints: 2000,
        netMinor: 150000,
        taxMinor: 30000,
      },
    ],
  };
  await page.route("**/v1/staff/receipts/receipt", (route) =>
    route.fulfill({ json: receipt }),
  );
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto("/sq/staff/receipts/receipt");
  await expect(page.getByTestId("receipt-total")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const width of ["58", "80"]) {
    await page.locator(".receipt-actions select").selectOption(width);
    const total = await page.getByTestId("receipt-total").innerText();
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".app-sidebar")).toBeHidden();
    await expect(page.locator(".app-platform-header")).toBeHidden();
    const printable = page.locator(".receipt-page");
    const maxWidth = (Number(width) * 96) / 25.4;
    expect((await printable.boundingBox())!.width).toBeLessThan(maxWidth);
    expect(
      await printable.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await expect(page.getByTestId("receipt-total")).toHaveText(total);
    await page.pdf({
      path: `artifacts/receipt-${width}.pdf`,
      width: `${width}mm`,
      height: "297mm",
    });
    await page.screenshot({
      path: `artifacts/receipt-${width}.png`,
      fullPage: true,
    });
    await page.emulateMedia({ media: "screen" });
  }
});

test("station reconnect clears a previous network error", async ({ page }) => {
  await fixture(page, "DE");
  await page.route("**/v1/staff/me", (route) =>
    route.fulfill({
      json: {
        staff: {
          tenantId: "DE",
          venueId: "venue-DE",
          email: "kitchen@demo.invalid",
          role: "KITCHEN",
          displayName: "Kitchen",
          venueName: "DE",
          tenantKind: "REAL",
        },
      },
    }),
  );
  let connected = false;
  await page.route("**/v1/staff/online-production/KITCHEN", (route) =>
    connected
      ? route.fulfill({ json: [] })
      : route.fulfill({ status: 503, json: {} }),
  );
  await page.addInitScript(() => {
    class FakeEvents {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      addEventListener() {}
      close() {}
      constructor() {
        (window as unknown as { stationEvents: FakeEvents }).stationEvents =
          this;
      }
    }
    window.EventSource = FakeEvents as unknown as typeof EventSource;
  });
  await page.goto("/de/staff/kitchen");
  const alert = page.locator(".online-production-board [role=alert]");
  await expect(alert).toBeVisible();
  connected = true;
  await page.evaluate(() =>
    (
      window as unknown as { stationEvents: { onopen: () => void } }
    ).stationEvents.onopen(),
  );
  await expect(alert).toHaveCount(0);
});
