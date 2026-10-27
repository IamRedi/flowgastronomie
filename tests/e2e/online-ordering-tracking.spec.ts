import { test, expect } from "@playwright/test";
import { orderingUxCopy } from "../../apps/web/lib/ordering-ux-copy";
import {
  mockOrdering,
  orderingToken,
  timingFixture,
  trackingFixture,
} from "../helpers/online-ordering-fixture";

for (const locale of ["sq", "de", "it", "en"] as const) {
  test(`ASAP and branded scheduled slots are accessible in ${locale}`, async ({
    page,
  }) => {
    await mockOrdering(page);
    const text = orderingUxCopy[locale];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const width of [1366, 1024, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
      await page.goto(`/${locale}/order/restaurant-olive-demo`);
      const asap = page.getByRole("button", { name: text.asap, exact: true });
      await expect(asap).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0);
      await expect(page.getByTestId("pickup-selection")).toContainText("17:20");
      const choose = page.getByRole("button", {
        name: text.choose,
        exact: true,
      });
      await choose.click();
      const dialog = page.getByRole("dialog", { name: text.choose });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: text.today, exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: text.tomorrow, exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Shift+Tab");
      expect(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
      ).toBe(true);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(choose).toBeFocused();
      await choose.click();
      await dialog.getByRole("button", { name: "17:45", exact: true }).click();
      await expect(page.getByTestId("pickup-selection")).toContainText("17:45");
      await expect(choose).toHaveAttribute("aria-pressed", "true");
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      const short = await page
        .locator(".pickup-timing button:visible")
        .evaluateAll(
          (elements) =>
            elements.filter((el) => el.getBoundingClientRect().height < 43.5)
              .length,
        );
      expect(short).toBe(0);
    }
    expect(errors).toEqual([]);
  });
}

test("ASAP submits without browser timestamp and recent session resumes from the public website", async ({
  page,
}) => {
  const state = await mockOrdering(page);
  await page.goto("/en/order/restaurant-olive-demo");
  await page.locator(".online-category article button").first().click();
  await page.locator('input[name="name"]').fill("Browser Guest");
  await page.locator('input[name="phone"]').fill("+49 30 123456");
  await page.getByRole("button", { name: "Place order", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/order/track/${orderingToken}\\?venue=restaurant-olive-demo$`),
  );
  expect(state.submissions[0]).toMatchObject({
    timingMode: "ASAP",
    fulfillmentType: "PICKUP",
  });
  expect(state.submissions[0]!.requestedFor).toBeUndefined();
  await expect(page.locator(".tracking-status")).toHaveAttribute(
    "data-state",
    "PENDING_CONFIRMATION",
  );
  await page.goto("/en/venue/restaurant-olive-demo");
  await page.getByRole("button", { name: "Track order", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Track order" });
  await expect(dialog).toContainText("RF-ABC123");
  await dialog.getByRole("link", { name: "Continue tracking" }).click();
  await expect(page.locator(".tracking-status")).toBeVisible();
  const stored = await page.evaluate(() =>
    sessionStorage.getItem("recent-online-order:v1:restaurant-olive-demo"),
  );
  expect(stored).not.toContain("+49 30 123456");
  expect(stored).not.toContain("phone");
  expect(page.url()).not.toContain("phone");
});

test("scheduled selection persists and is sent as the offered absolute instant", async ({
  page,
}) => {
  const state = await mockOrdering(page);
  await page.goto("/en/order/restaurant-olive-demo");
  await page
    .getByRole("button", { name: "Choose a time", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Tomorrow", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "17:30", exact: true })
    .click();
  await page.locator(".online-category article button").first().click();
  await expect(page.getByTestId("pickup-selection")).toContainText("17:30");
  await page.locator('input[name="name"]').fill("Browser Guest");
  await page.locator('input[name="phone"]').fill("+49 30 123456");
  await page.getByRole("button", { name: "Place order", exact: true }).click();
  await expect(page.locator(".tracking-status")).toBeVisible();
  expect(state.submissions[0]).toMatchObject({
    timingMode: "SCHEDULED",
    requestedFor: timingFixture.slots[2]!.at,
  });
});

for (const locale of ["sq", "de", "it", "en"] as const) {
  test(`reference-only lookup is minimal and refreshes safely in ${locale}`, async ({
    page,
  }) => {
    const state = await mockOrdering(page);
    const words = orderingUxCopy[locale];
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${locale}/venue/restaurant-olive-demo`);
    await page.getByRole("button", { name: words.track, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: words.track });
    await expect(dialog.locator("input")).toHaveCount(1);
    await dialog.getByLabel(words.reference).fill("RF-WRONG1");
    await dialog
      .getByRole("button", { name: words.lookup, exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toHaveText(
      words.publicStatusFailed,
    );
    await dialog.getByLabel(words.reference).fill("RF-ABC123");
    const requested = page.waitForRequest((r) => r.url().endsWith("/status"));
    await dialog
      .getByRole("button", { name: words.lookup, exact: true })
      .click();
    const request = await requested;
    expect(request.method()).toBe("POST");
    expect(request.postDataJSON()).toEqual({ referenceCode: "RF-ABC123" });
    await expect(dialog.getByRole("status")).toHaveAttribute(
      "data-state",
      "PENDING_CONFIRMATION",
    );
    await expect(dialog.getByRole("status")).toContainText("17:20");
    for (const privateValue of [
      "Browser Guest",
      "Margherita",
      "side entrance",
      "40 cm",
      "12.50",
      "+49",
    ]) {
      await expect(dialog).not.toContainText(privateValue);
    }
    expect(page.url()).not.toContain("RF-ABC123");
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("recent-online-order:v1:restaurant-olive-demo"),
      ),
    ).toBeNull();
    state.status = "READY";
    await dialog
      .getByRole("button", { name: words.publicStatusRefresh, exact: true })
      .click();
    await expect(dialog.getByRole("status")).toHaveAttribute(
      "data-state",
      "READY",
    );
    await page.route("**/v1/public/online-orders/*/status", (route) =>
      route.fulfill({ status: 429, json: { code: "RATE_LIMIT_EXCEEDED" } }),
    );
    await dialog
      .getByRole("button", { name: words.publicStatusRefresh, exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toHaveText(
      words.publicStatusLimited,
    );
    await expect(dialog.getByRole("status")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: words.track, exact: true }),
    ).toBeFocused();
  });
}

test("SSE updates all progress and terminal states without navigation; products, extras and messages stay visible", async ({
  page,
}) => {
  await mockOrdering(page);
  await page.goto(
    `/en/order/track/${orderingToken}?venue=restaurant-olive-demo`,
  );
  await expect(page.locator(".tracking-status")).toBeVisible();
  const initial = page.url();
  for (const status of [
    "PENDING_CONFIRMATION",
    "ACCEPTED",
    "PREPARING",
    "READY",
    "COMPLETED",
    "REJECTED",
    "CANCELLED",
    "OUT_FOR_DELIVERY",
  ]) {
    await page.evaluate(
      (order) =>
        window.__orderingStreams.forEach((stream) =>
          stream.dispatchEvent(
            new MessageEvent("order", { data: JSON.stringify(order) }),
          ),
        ),
      trackingFixture(status),
    );
    await expect(page.locator(".tracking-status")).toHaveAttribute(
      "data-state",
      status,
    );
    expect(page.url()).toBe(initial);
    if (status === "READY") {
      await expect(
        page.getByRole("heading", { name: "Ready for pickup", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: "artifacts/ordering-tracking-ready.png",
        fullPage: true,
      });
    }
  }
  await expect(page.locator(".tracking-summary")).toContainText("40 cm");
  await expect(page.locator(".tracking-summary")).toContainText("Basil");
  await expect(page.locator(".tracking-summary")).toContainText(
    "Browser Guest",
  );
  await expect(page.locator(".tracking-latest")).toContainText("side entrance");
  expect(await page.evaluate(() => window.__orderingEventUrls[0])).toContain(
    `/track/${orderingToken}/events`,
  );
});

test("polling fallback updates progress automatically when SSE cannot connect", async ({
  page,
}) => {
  const state = await mockOrdering(page, true);
  await page.goto(
    `/en/order/track/${orderingToken}?venue=restaurant-olive-demo`,
  );
  await expect(page.locator(".tracking-status")).toHaveAttribute(
    "data-state",
    "PENDING_CONFIRMATION",
  );
  state.status = "READY";
  await expect(page.locator(".tracking-status")).toHaveAttribute(
    "data-state",
    "READY",
    { timeout: 12_000 },
  );
  await expect(page.getByRole("status")).toContainText(
    "checking for updates automatically",
  );
});
