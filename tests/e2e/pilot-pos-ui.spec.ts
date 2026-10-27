import { expect } from "@playwright/test";
import { test } from "./authenticated-test";

for (const width of [1024, 1366, 390]) {
  test(`POS search, product modal and cart remain accessible at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 768 });
    await page.goto("/app/en/overview");
    await expect(page).toHaveURL(/\/app\/en\/overview$/);
    await page.goto("/en/staff/pos");
    const product = page
      .locator(".pos-product")
      .filter({ hasText: "Margherita 2.0" });
    await expect(product).toBeVisible();
    // Production builds do not present demo photography as real product media.
    await expect(product.locator(".pos-product-media svg")).toBeVisible();
    await expect(product.locator(".pos-photo-label")).toHaveCount(0);
    await expect(
      page.locator(".register-panel > .pos-tool-trigger"),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByRole("button", { name: "Hardware settings", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    if (width < 761)
      await page.getByRole("button", { name: "Expand navigation" }).click();
    await expect(
      page
        .getByRole("navigation", { name: "Operations" })
        .getByRole("link", { name: "Counter", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    if (width < 761) await page.keyboard.press("Escape");
    const search = page.getByRole("searchbox", { name: "Search products" });
    await expect(search).toHaveCount(0);
    const searchButton = page.getByRole("button", { name: "Search products" });
    await searchButton.click();
    await expect(search).toBeFocused();
    await search.fill("no-product-with-this-name");
    await expect(page.getByText("No products match")).toBeVisible();
    await search.press("Escape");
    await expect(search).toHaveCount(0);
    await expect(searchButton).toBeFocused();
    await product.click();
    const modal = page.getByRole("dialog", { name: "Margherita 2.0" });
    await expect(modal).toBeVisible();
    // Native modal makes background controls inert and contains keyboard focus.
    await expect(modal).toHaveJSProperty("open", true);
    const modalButtons = modal.getByRole("button");
    await modalButtons.last().focus();
    await page.keyboard.press("Tab");
    await expect(modalButtons.first()).toBeFocused();
    await modal.getByRole("button", { name: /Large 40 cm/ }).click();
    await modal.getByRole("button", { name: /Mushrooms/ }).click();
    await modal.getByLabel("Kitchen note (optional)").fill("No onions");
    await modal.getByRole("button", { name: "Increase quantity" }).click();
    await expect(modal.locator("output")).toHaveText("2");
    await page.screenshot({ path: `artifacts/pos-product-${width}.png` });
    await modal.getByRole("button", { name: "Add", exact: true }).click();
    await expect(modal).toHaveCount(0);
    await expect(product).toBeFocused();
    const lines = page.locator(".pos-cart-lines li");
    await expect(lines).toHaveCount(1);
    await expect(lines.first()).toContainText("Large 40 cm");
    await expect(lines.first()).toContainText("Mushrooms");
    await expect(lines.first()).toContainText("No onions");
    await expect(lines.first().locator(".pos-line-actions span")).toHaveText(
      "2",
    );
    await expect(product).toHaveClass(/is-selected/);
    if (width >= 1024) {
      const action = await page.locator(".pos-submit").boundingBox();
      expect(action!.y + action!.height).toBeLessThanOrEqual(768);
      await page.screenshot({ path: `artifacts/pos-cart-${width}.png` });
    }
    // A different note must survive as its own line, including after editing.
    await lines.first().locator("summary").click();
    await lines.first().getByLabel("Kitchen note (optional)").fill("No garlic");
    await product.click();
    await modal.getByRole("button", { name: /Large 40 cm/ }).click();
    await modal.getByRole("button", { name: /Mushrooms/ }).click();
    await modal.getByLabel("Kitchen note (optional)").fill("No onions");
    await modal.getByRole("button", { name: "Add", exact: true }).click();
    await expect(lines).toHaveCount(2);
    await expect(lines.first()).toContainText("No garlic");
    await expect(lines.last()).toContainText("No onions");
    await product.click();
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(product).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const targets = await page
      .locator(
        ".pos-page button:visible, .pos-page a:visible, .pos-page summary:visible",
      )
      .evaluateAll((elements) =>
        elements.map((element) => ({
          name: element.textContent,
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
        })),
      );
    expect(
      targets.filter((target) => target.width < 44 || target.height < 44),
    ).toEqual([]);
    expect(errors).toEqual([]);
  });
}
