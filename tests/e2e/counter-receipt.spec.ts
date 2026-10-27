import { expect, test } from "./browser-test";

test("manager opens register, takes cash and confirmed card, and prints finalized receipts", async ({
  page,
}) => {
  await page.goto("/en/staff/login");
  await page.locator('input[name="password"]').fill("Demo1234!");
  await page
    .locator('input[name="email"]')
    .fill("manager@flowgastronomie.local");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\/en\/overview$/);
  const shiftResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/v1/staff/shift") && r.request().method() === "GET",
  );
  await page.goto("/en/staff/pos");
  const register = page.getByRole("region", {
    name: "Register",
    exact: true,
    includeHidden: true,
  });
  await expect(register).toHaveAttribute("aria-busy", "false");
  const currentShift = await (await shiftResponse).json();
  await register
    .getByRole("button", { name: /Register|No open register/, exact: true })
    .click();
  // A retry may inherit the previous attempt's demo register; close it through
  // the real API rather than deleting data or assuming an empty database.
  await expect(register.getByLabel(/Opening cash|Counted cash/)).toBeVisible();
  await expect(page.locator(".pos-product").first()).toBeVisible();
  const start = register.getByRole("button", { name: "Start shift" });
  if (!currentShift.shift) {
    await start.click();
    await expect(start).toBeHidden();
  }
  const close = register.getByRole("button", { name: "Close register" });
  if (await close.isVisible()) {
    await register.getByLabel("Counted cash").fill("0.00");
    await close.click();
    await expect(register.getByLabel("Opening cash")).toBeVisible();
  }
  await register.getByLabel("Opening cash").fill("1.00");
  await register
    .getByRole("button", { name: "Open register", exact: true })
    .click();
  await expect(register.getByLabel("Counted cash")).toBeHidden();

  async function createOrder() {
    await page
      .locator(".pos-product")
      .filter({ hasText: "Seasonal burrata" })
      .first()
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add", exact: true })
      .click();
    await page.locator(".pos-submit").click();
    await expect(page.getByText("Order sent to the kitchen")).toBeVisible();
  }
  await createOrder();
  await page.getByLabel("Amount received").fill("20.00");
  await expect(
    page.getByRole("button", { name: "Confirm cash payment" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Confirm cash payment" }).click();
  await expect(
    page.getByRole("heading", { name: /Receipt #R-\d+/ }),
  ).toBeVisible();
  const receiptUrl = await page
    .getByRole("link", { name: "Open receipt" })
    .getAttribute("href");
  await page.getByRole("button", { name: "New order", exact: true }).click();
  await register.getByRole("button", { name: "Register", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Register", exact: true }),
  ).toContainText("€13.50");
  await page.keyboard.press("Escape");
  await page.goto(receiptUrl!);
  await expect(page.getByTestId("receipt-total")).toHaveText("€12.50");
  await expect(page.locator("main")).toContainText("DEMO_TEST_10");
  await expect(page.locator("main")).toContainText("€7.50");
  const firstNumber = await page
    .getByRole("heading", { name: /Receipt #R-/ })
    .innerText();
  await expect(
    page.getByRole("button", { name: "Print", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "New order" }).click();
  await createOrder();
  await page.getByRole("button", { name: "Card", exact: true }).click();
  const confirmCard = page.getByRole("button", {
    name: "Confirm card payment",
  });
  await expect(confirmCard).toBeDisabled();
  await page.getByRole("checkbox").check();
  await confirmCard.click();
  await page.getByRole("link", { name: "Open receipt" }).click();
  await expect(page.getByTestId("receipt-total")).toHaveText("€12.50");
  await expect(page.locator("main")).toContainText("Payment method: Card");
  await expect(
    page.getByRole("heading", { name: /Receipt #R-/ }),
  ).not.toHaveText(firstNumber);
  await page.getByRole("link", { name: "New order" }).click();
  await register.getByRole("button", { name: "Register", exact: true }).click();
  await expect(register).toContainText("€13.50");
  await register.getByLabel("Counted cash").fill("13.50");
  await register.getByRole("button", { name: "Close register" }).click();
  await expect(register.getByLabel("Opening cash")).toBeVisible();
  await expect(register).toContainText("Difference: €0.00");
});
