import { expect, test } from "@playwright/test";
import { prisma } from "@flowgastronomie/database";

test("website pickup joins Orders, Kitchen and counter receipt without a second payment", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/en/staff/login");
  await page.locator('input[name="tenantSlug"]').fill("flowgastronomie-demo");
  await page.locator('input[name="venueSlug"]').fill("restaurant-olive");
  await page.locator('input[name="password"]').fill("Demo1234!");
  await page
    .locator('input[name="email"]')
    .fill("manager@flowgastronomie.local");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\/en\/overview$/);
  const navigation = page.getByRole("navigation", { name: "Operations" });
  await expect(
    navigation.getByRole("link", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(navigation).toContainText("Counter");
  await expect(navigation).toContainText("Orders");
  await expect(navigation).toContainText("Kitchen");
  await expect(
    navigation.getByRole("link", { name: "Website", exact: true }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Menu", exact: true }),
  ).toBeVisible();
  const api = "http://localhost:4100";
  const shift = await page.request.get(`${api}/v1/staff/shift`);
  if (!(await shift.json()).shift)
    expect(
      (
        await page.request.post(`${api}/v1/staff/shift/start`, { data: {} })
      ).ok(),
    ).toBe(true);
  const register = await page.request.get(`${api}/v1/staff/register`);
  if (!(await register.json()).session)
    expect(
      (
        await page.request.post(`${api}/v1/staff/register/open`, {
          data: { openingCashMinor: 0 },
        })
      ).ok(),
    ).toBe(true);
  expect(
    (
      await page.request.put(`${api}/v1/staff/online-order-settings`, {
        data: {
          pickupEnabled: true,
          deliveryEnabled: false,
          cateringEnabled: false,
        },
      })
    ).ok(),
  ).toBe(true);

  await page.goto("/en/venue/restaurant-olive-demo");
  await page.getByRole("link", { name: "Order", exact: true }).first().click();
  await expect(page).toHaveURL(/\/en\/order\/restaurant-olive-demo$/);
  await expect(page.locator("select option")).toHaveCount(1);
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  await page.getByPlaceholder("Name").fill("Pilot pickup guest");
  await page.getByPlaceholder("Phone").fill("+49 30 5550100");
  await expect(
    page.getByRole("button", { name: "As soon as possible", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page).toHaveURL(/\/en\/order\/track\//);
  const reference = (await page.locator("header strong").textContent())?.trim();
  expect(reference).toBeTruthy();
  const tracking = await page.context().newPage();
  const stream = tracking.waitForResponse(
    (response) =>
      response.url().includes("/events") &&
      response.headers()["content-type"]?.includes("text/event-stream") ===
        true,
  );
  await tracking.goto(page.url());
  await stream;
  await expect(tracking.locator(".tracking-status")).toHaveAttribute(
    "data-state",
    "PENDING_CONFIRMATION",
  );

  await page.goto("/en/staff/orders");
  const card = page.locator(`[data-order-reference="${reference}"]`);
  await expect(card).toContainText("Awaiting confirmation");
  await card.getByRole("button", { name: "Open order" }).click();
  const details = page.locator(".simple-order-detail");
  await details.getByRole("button", { name: "Accept" }).click();
  await expect(tracking.locator(".tracking-status")).toHaveAttribute(
    "data-state",
    "ACCEPTED",
    { timeout: 12_000 },
  );
  await expect(card).toContainText("Pending payment");

  await page.goto("/en/staff/kitchen");
  const ticket = page
    .locator(".online-production-board article")
    .filter({ hasText: reference! });
  const persisted = await prisma.onlineOrder.findUniqueOrThrow({
    where: { referenceCode: reference! },
  });
  if (
    persisted.productionNotBefore &&
    persisted.productionNotBefore > new Date()
  ) {
    await expect(ticket).toHaveCount(0);
    // Simulate reaching the production window in this disposable E2E DB.
    // No frontend clock overrides or changes to payment/receipt behavior.
    await prisma.onlineOrder.update({
      where: { id: persisted.id },
      data: { productionNotBefore: new Date(Date.now() - 1000) },
    });
    await page.reload();
  }
  await expect(ticket).toBeVisible();
  await page.goto("/en/staff/orders");
  await card.getByRole("button", { name: "Open order" }).click();
  await details
    .getByRole("button", { name: "KITCHEN: Start preparing" })
    .click();
  await expect(tracking.locator(".tracking-status")).toHaveAttribute(
    "data-state",
    "PREPARING",
    { timeout: 12_000 },
  );
  await details.getByRole("button", { name: "KITCHEN: Mark ready" }).click();
  await expect(tracking.locator(".tracking-status")).toHaveAttribute(
    "data-state",
    "READY",
    { timeout: 12_000 },
  );
  await expect(card).toContainText("Ready");
  await details.getByLabel("Amount received").fill("30.00");
  await details.getByRole("button", { name: "Confirm cash payment" }).click();
  await expect(
    details.getByRole("heading", { name: /Receipt #R-/ }),
  ).toBeVisible();
  await expect(card).toContainText("Paid");
  await details.getByRole("link", { name: "Open receipt" }).click();
  await expect(page.getByTestId("receipt-total")).toBeVisible();
  await page.goto("/en/staff/orders");
  await card.getByRole("button", { name: "Open order" }).click();
  await expect(details.getByLabel("Amount received")).toHaveCount(0);
  await expect(
    details.getByRole("link", { name: "Open receipt" }),
  ).toBeVisible();
  await page.goto("/en/venue/restaurant-olive-demo");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Track order", exact: true }).click();
  const recovery = page.getByRole("dialog", {
    name: "Track order",
    exact: true,
  });
  await recovery.getByLabel("Order code").fill(reference!);
  await recovery
    .getByRole("button", { name: "Find your order", exact: true })
    .click();
  await expect(recovery.locator(".public-order-status")).toHaveAttribute(
    "data-state",
    "READY",
  );
  await expect(recovery.getByLabel("Phone number")).toHaveCount(0);
  // Compatibility recovery still requires both verifiers and issues a private
  // cookie. The normal public lookup above must never grant this access.
  const recovered = await page.request.post(
    "http://localhost:4100/v1/public/online-orders/restaurant-olive-demo/recover",
    { data: { referenceCode: reference, phone: "+49 30 5550100" } },
  );
  expect(recovered.status()).toBe(200);
  await page.goto("/en/order/track/recovered?venue=restaurant-olive-demo");
  await expect(page.locator(".tracking-status")).toHaveAttribute(
    "data-state",
    "READY",
  );
  const cookies = await page
    .context()
    .cookies("http://localhost:4100/v1/public/online-orders/track/recovered");
  expect(
    cookies.some(
      (cookie) =>
        cookie.name.startsWith("flowgastronomie_order_recovery_") &&
        cookie.httpOnly,
    ),
  ).toBe(true);
  await prisma.$disconnect();
  await tracking.close();
});
