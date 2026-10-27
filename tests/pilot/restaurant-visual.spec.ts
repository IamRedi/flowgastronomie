import { test, expect } from "@playwright/test";

// Read-only local review. Kitchen tickets are labeled fixtures; no operational
// writes are sent. Before/after use the same routes, viewport and fixture data.
test("restaurant visual review across panel, POS, editor and kitchen", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const phase = process.env.RESTAURANT_VISUAL_PHASE ?? "after";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/en/staff/login");
  await page.locator('input[name="tenantSlug"]').fill("flowgastronomie-demo");
  await page.locator('input[name="venueSlug"]').fill("restaurant-olive");
  await page.locator('input[name="password"]').fill("Demo1234!");
  await page
    .locator('input[name="email"]')
    .fill("manager@flowgastronomie.local");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await page.route("**/v1/staff/production/KITCHEN", (route) =>
    route.fulfill({
      json: [
        {
          id: "visual-new",
          orderId: "visual-order-new",
          reference: "VIS-104",
          version: 1,
          status: "NEW",
          station: "KITCHEN",
          orderType: "TAKEAWAY",
          tableLabel: null,
          createdAt: new Date(Date.now() - 240_000).toISOString(),
          items: [
            {
              productName: "Margherita",
              variantName: "40 cm",
              quantity: 2,
              notes: "No onions - visual fixture",
              modifiers: [],
            },
          ],
          canStart: true,
          canReady: false,
          canServe: false,
        },
        {
          id: "visual-preparing",
          orderId: "visual-order-preparing",
          reference: "VIS-103",
          version: 1,
          status: "PREPARING",
          station: "KITCHEN",
          orderType: "DINE_IN",
          tableLabel: "4",
          createdAt: new Date(Date.now() - 480_000).toISOString(),
          items: [
            {
              productName: "Diavola",
              variantName: "30 cm",
              quantity: 1,
              notes: "Visual fixture",
              modifiers: [],
            },
          ],
          canStart: false,
          canReady: true,
          canServe: false,
        },
      ],
    }),
  );
  const shot = async (name: string) => {
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/restaurant-redesign/${phase}/${name}.png`,
      style: "nextjs-portal{display:none!important}",
      animations: "disabled",
    });
  };
  for (const width of [1366, 1024]) {
    await page.setViewportSize({ width, height: 768 });
    await page.goto("/app/en/overview");
    await expect(
      page.getByTestId("active-orders").locator("strong"),
    ).toHaveText(/^\d+$/);
    await shot(`dashboard-${width}`);
    await page.goto("/en/staff/pos");
    const product = page
      .locator(".pos-product")
      .filter({ hasText: "Margherita" });
    await expect(product).toBeVisible();
    if (phase === "after") {
      const media = product.locator(".pos-product-media");
      await expect(media).toBeVisible();
      await expect(media.locator("img")).toBeVisible();
      await expect
        .poll(() =>
          media
            .locator("img")
            .evaluate(
              (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
            ),
        )
        .toBe(true);
    }
    await product.click();
    const dialog = page.getByRole("dialog", {
      name: "Margherita",
      exact: true,
    });
    await dialog.getByRole("button", { name: /40 cm/ }).click();
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.locator(".pos-cart-lines li")).toHaveCount(1);
    await shot(`pos-${width}`);
    const action = await page.locator(".pos-submit").boundingBox();
    expect(action!.y + action!.height).toBeLessThanOrEqual(768);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en/staff/pos");
  await expect(
    page.locator(".pos-product").filter({ hasText: "Margherita" }),
  ).toBeVisible();
  await shot("pos-390");
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/en/staff/menu");
  const row = page.locator(".menu-admin-product").filter({
    has: page.getByRole("heading", { name: "Margherita", exact: true }),
  });
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await row.locator(".product-editor").scrollIntoViewIfNeeded();
  await shot("menu-editor-1366");
  await page.goto("/en/staff/kitchen");
  await expect(page.getByText("VIS-104", { exact: false })).toBeVisible();
  await shot("kitchen-fixture-1366");
  await page.goto("/en/staff/orders");
  await expect(page.locator(".simple-orders-page")).toBeVisible();
  await shot("orders-1366");
  if (phase === "after") {
    await page.route(/\/_next\/image\?.*margherita/, (route) => route.abort());
    await page.goto("/en/staff/pos");
    await page.reload();
    const fallback = page
      .locator(".pos-product")
      .filter({ hasText: "Margherita" });
    await expect(fallback.locator(".pos-product-media svg")).toBeVisible();
    await expect(fallback).toBeEnabled();
    await expect(fallback.locator(".pos-photo-label")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
