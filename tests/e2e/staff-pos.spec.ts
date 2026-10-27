import { expect, test } from "./browser-test";

const apiOrigin = "http://localhost:4100";

test("manager creates a takeaway POS order that reaches the kitchen board", async ({
  page,
}) => {
  await page.goto("/en/staff/login");
  await page.locator('input[name="password"]').fill("Demo1234!");
  await page
    .locator('input[name="email"]')
    .fill("manager@flowgastronomie.local");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\/en\/overview$/);

  const shiftResponse = await page.request.get(`${apiOrigin}/v1/staff/shift`);
  expect(shiftResponse.ok()).toBe(true);
  const current = (await shiftResponse.json()) as { shift: unknown | null };
  if (!current.shift) {
    const started = await page.request.post(
      `${apiOrigin}/v1/staff/shift/start`,
      { data: {} },
    );
    expect(started.ok()).toBe(true);
  }

  await page.goto("/en/staff/pos");
  await expect(
    page
      .locator(".app-platform-header")
      .getByRole("heading", { name: "Counter" }),
  ).toBeVisible();

  const product = page
    .locator(".pos-product")
    .filter({ hasText: "Seasonal burrata" })
    .first();
  await product.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add", exact: true })
    .click();

  const cartLine = page.locator(".pos-cart-lines li").filter({
    hasText: "Seasonal burrata",
  });
  await expect(cartLine).toHaveCount(1);

  await page.locator(".pos-submit").click();
  await expect(page.getByText("Order sent to the kitchen")).toBeVisible();
  await page.getByRole("button", { name: "New order" }).click();

  await page.goto("/en/staff/kitchen");
  await expect(page.locator("main")).toContainText("Seasonal burrata");
});
