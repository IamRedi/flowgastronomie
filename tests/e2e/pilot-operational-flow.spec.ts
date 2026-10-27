import { expect, test, type Page } from "./browser-test";

async function login(page: Page) {
  await page.goto("/en/staff/login");
  await page.locator('input[name="password"]').fill("Demo1234!");
  await page
    .locator('input[name="email"]')
    .fill("manager@flowgastronomie.local");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/en\/overview$/);
}

test("pizzeria takeaway keeps the same pizza snapshot through kitchen, cash receipt and pickup", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await login(page);
  const shiftResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/v1/staff/shift") && r.request().method() === "GET",
  );
  await page
    .getByRole("navigation", { name: "Operations" })
    .getByRole("link", { name: "Counter", exact: true })
    .click();
  const register = page.getByRole("region", { name: "Register", exact: true });
  await expect(register).toHaveAttribute("aria-busy", "false");
  await register
    .getByRole("button", { name: /Register|No open register/, exact: true })
    .click();
  const shift = register.getByRole("button", {
    name: "Start shift",
    exact: true,
  });
  if (!(await (await shiftResponse).json()).shift) {
    await shift.click();
    await expect(shift).toBeHidden();
  }
  const opening = register.getByLabel("Opening cash");
  if (await opening.isVisible()) {
    await opening.fill("0.00");
    await register
      .getByRole("button", { name: "Open register", exact: true })
      .click();
    await expect(opening).toBeHidden();
  } else {
    await page.keyboard.press("Escape");
  }
  const pizza = page
    .locator(".pos-product")
    .filter({ hasText: "Margherita 2.0" });
  await expect(page.locator(".pos-product").first()).toBeVisible();
  const initialBounds = await page
    .locator(".pos-product")
    .first()
    .boundingBox();
  expect(initialBounds!.y + initialBounds!.height).toBeLessThanOrEqual(768);
  await page
    .getByRole("button", { name: "Stone-baked pizza", exact: true })
    .click();
  await expect(pizza).toBeVisible();
  const bounds = await pizza.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(768);
  await page.screenshot({ path: "artifacts/p3a-pos-1024.png" });
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(pizza).toBeVisible();
  const wideBounds = await pizza.boundingBox();
  expect(wideBounds!.y + wideBounds!.height).toBeLessThanOrEqual(768);
  await page.screenshot({ path: "artifacts/pilot-pos-1366.png" });
  await page.setViewportSize({ width: 1024, height: 768 });
  await pizza.click();
  const configuration = page.getByRole("dialog", { name: "Margherita 2.0" });
  await configuration.getByRole("button", { name: /Large 40 cm/ }).click();
  await configuration.getByRole("button", { name: /Mushrooms/ }).click();
  await configuration.getByRole("button", { name: "Add", exact: true }).click();
  await page.locator(".pos-line-note summary").click();
  await page.getByLabel("Kitchen note (optional)").fill("No onions, please");
  const submitBounds = await page.locator(".pos-submit").boundingBox();
  expect(submitBounds!.y + submitBounds!.height).toBeLessThanOrEqual(768);
  await page.locator(".pos-submit").click();
  await expect(
    page.getByText("Order sent to the kitchen", { exact: true }),
  ).toBeVisible();
  const reference = (
    await page.locator(".pos-confirmation code").innerText()
  ).trim();
  await page
    .locator(".pos-confirmation")
    .getByRole("button", { name: "New order", exact: true })
    .click();
  await page.goto("/en/staff/orders");
  const queue = page.locator(".simple-orders-page");
  await expect(
    queue.locator(`[data-order-reference="${reference}"]`),
  ).toContainText("Pending payment");
  await page
    .getByRole("navigation", { name: "Operations" })
    .getByRole("link", { name: "Kitchen", exact: true })
    .click();
  const ticket = page.locator(
    `.pilot-ticket[data-order-reference="${reference}"]`,
  );
  await expect(ticket).toContainText("Takeaway");
  await expect(ticket).toContainText("Large 40 cm");
  await expect(ticket).toContainText("Mushrooms");
  await expect(ticket).toContainText("No onions, please");
  await ticket.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/p3a-kitchen.png" });
  await ticket
    .getByRole("button", { name: "Start preparing", exact: true })
    .click();
  const ready = ticket.getByRole("button", { name: "Mark ready", exact: true });
  await expect(ready).toBeEnabled();
  expect((await ready.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await ready.click();
  await expect(ticket).toContainText("Ready");
  await page
    .getByRole("navigation", { name: "Operations" })
    .getByRole("link", { name: "Orders", exact: true })
    .click();
  const active = page.locator(
    `.simple-orders-page [data-order-reference="${reference}"]`,
  );
  await expect(active).toContainText("Ready");
  await active.getByRole("button", { name: "Open order" }).click();
  const order = page.locator(".simple-order-detail");
  await order.getByLabel("Amount received").fill("30.00");
  await order.getByRole("button", { name: "Confirm cash payment" }).click();
  await expect(
    order.getByRole("heading", { name: /Receipt #R-/ }),
  ).toBeVisible();
  await expect(active).toContainText("Paid");
  await order.getByRole("link", { name: "Open receipt" }).click();
  await expect(page.getByTestId("receipt-total")).toBeVisible();
  await page.screenshot({ path: "artifacts/p3a-receipt.png" });
  await page.getByRole("link", { name: "New order" }).click();
  await page.goto("/en/staff/orders");
  const activeAgain = page.locator(
    `.simple-orders-page [data-order-reference="${reference}"]`,
  );
  await activeAgain.getByRole("button", { name: "Open order" }).click();
  await expect(
    order.getByRole("heading", { name: /Receipt #R-/ }),
  ).toBeVisible();
  await expect(order.getByLabel("Amount received")).toHaveCount(0);
  await order
    .getByRole("button", { name: "Mark picked up", exact: true })
    .click();
  await expect(activeAgain).toHaveCount(0);
});

test("QR table pizza retains its details and completes through Kitchen without POS attribution", async ({
  page,
}) => {
  await page.goto("/en/menu/demo-table-07");
  const product = page.locator("article").filter({
    has: page.getByRole("heading", { name: "Margherita 2.0", exact: true }),
  });
  await product.locator("select").selectOption("variant-pizza-large");
  await product.getByRole("checkbox", { name: /Mushrooms/ }).check();
  await product
    .getByRole("button", { name: "Add: Margherita 2.0", exact: true })
    .click();
  const response = page.waitForResponse(
    (r) =>
      /\/v1\/public\/sessions\/[^/]+\/orders$/.test(r.url()) &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send order", exact: true }).click();
  const body = await (await response).json();
  const reference = body.id.slice(-8).toUpperCase();
  await expect(page.getByRole("status")).toContainText(
    "Order sent successfully.",
  );
  await login(page);
  const shiftResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/v1/staff/shift") && r.request().method() === "GET",
  );
  await page.goto("/en/staff/kitchen");
  if (!(await (await shiftResponse).json()).shift) {
    await page
      .getByRole("button", { name: "Start shift", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Start shift", exact: true }),
    ).toBeHidden();
  }
  const ticket = page.locator(
    `.pilot-ticket[data-order-reference="${reference}"]`,
  );
  await expect(ticket).toContainText("Table 07");
  await expect(ticket).toContainText("Large 40 cm");
  await expect(ticket).toContainText("Mushrooms");
  await ticket
    .getByRole("button", { name: "Start preparing", exact: true })
    .click();
  await ticket.getByRole("button", { name: "Mark ready", exact: true }).click();
  await ticket
    .getByRole("button", { name: "Mark served", exact: true })
    .click();
  await expect(ticket).toHaveCount(0);
});
