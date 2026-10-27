import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "./authenticated-test";
import en from "../../apps/web/dictionaries/en.json";
import de from "../../apps/web/dictionaries/de.json";
import it from "../../apps/web/dictionaries/it.json";
import sq from "../../apps/web/dictionaries/sq.json";

const labels = en.menuAdmin;
const copy = (editor: Locator) =>
  editor.getByRole("button", { name: labels.copyPrimary });
async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function save(page: Page, form: Locator, name: string, path: string) {
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith(path) &&
      ["POST", "PUT"].includes(response.request().method()),
  );
  await form.getByRole("button", { name, exact: true }).click();
  expect((await response).ok()).toBe(true);
  await expect(form).toHaveCount(0);
}

for (const width of [1366, 1024, 390]) {
  test(`menu translations and independent variants save at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 768 });
    await page.goto("/en/staff/menu");
    if (width === 1024) {
      await page
        .getByRole("button", { name: "Expand navigation", exact: true })
        .click();
    }
    const categoryName = `Editor ${width} ${Date.now()}`;
    await page
      .getByRole("button", { name: `+ ${labels.addCategory}`, exact: true })
      .click();
    const categoryForm = page.locator(".menu-editor-form");
    await categoryForm
      .getByLabel("Name · English", { exact: true })
      .fill(categoryName);
    await expect(
      categoryForm.getByLabel("Name · German", { exact: true }),
    ).not.toBeVisible();
    // Empty required names are revealed by native validation, never silently dropped.
    await categoryForm
      .getByRole("button", { name: labels.save, exact: true })
      .click();
    await expect(categoryForm.locator("details")).toHaveAttribute("open", "");
    await expect(categoryForm.locator("input:invalid").first()).toBeFocused();
    await copy(categoryForm).click();
    await categoryForm.getByLabel(labels.published, { exact: true }).uncheck();
    await save(page, categoryForm, labels.save, "/v1/staff/menu/categories");
    const category = page.locator(".menu-admin-category").filter({
      has: page.getByRole("heading", { name: categoryName, exact: true }),
    });
    await category
      .getByRole("button", { name: `+ ${labels.addProduct}`, exact: true })
      .click();
    const productForm = category.locator(".product-editor");
    await productForm
      .getByLabel("Name · English", { exact: true })
      .fill("Pizza test");
    await productForm
      .getByLabel("Description · English", { exact: true })
      .fill("Tomato and basil");
    await productForm.getByLabel("Price (EUR)", { exact: true }).fill("9.90");
    await productForm.getByLabel(labels.published, { exact: true }).uncheck();
    await copy(productForm).click();
    await productForm.locator("summary").click();
    await productForm
      .getByLabel("Name · German", { exact: true })
      .fill("Testpizza");
    await productForm.locator("summary").click();
    await fits(page);
    await productForm.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `artifacts/menu-editor/product-${width}.png`,
    });
    await save(page, productForm, labels.save, "/v1/staff/menu/products");
    const product = category.locator(".menu-admin-product");
    await product
      .getByRole("button", { name: labels.edit, exact: true })
      .click();
    await productForm.locator("summary").click();
    await expect(
      productForm.getByLabel("Name · German", { exact: true }),
    ).toHaveValue("Testpizza");
    await expect(
      productForm.getByRole("textbox", {
        name: "Description · Italian",
        exact: true,
      }),
    ).toHaveValue("Tomato and basil");
    await productForm
      .getByRole("button", { name: labels.cancel, exact: true })
      .click();
    await product
      .getByRole("button", { name: labels.configure, exact: true })
      .click();
    const config = product.getByRole("form", { name: labels.configure });
    await config
      .getByRole("button", { name: `+ ${labels.addVariant}`, exact: true })
      .click();
    const variants = config.locator(".configuration-variant");
    await variants
      .nth(0)
      .getByLabel("Name · English", { exact: true })
      .fill("30 cm");
    await copy(variants.nth(0)).click();
    await config
      .getByRole("button", { name: `+ ${labels.addVariant}`, exact: true })
      .click();
    await expect(variants.nth(0).getByRole("radio")).toBeChecked();
    await variants
      .nth(1)
      .getByLabel("Name · English", { exact: true })
      .fill("40 cm");
    await copy(variants.nth(1)).click();
    await variants.nth(1).getByLabel("Price adjustment (EUR)").fill("3");
    await variants
      .nth(1)
      .getByLabel(labels.available, { exact: true })
      .uncheck();
    await variants.nth(1).getByRole("radio").check();
    await expect(
      variants.nth(0).getByLabel("Name · English", { exact: true }),
    ).toHaveValue("30 cm");
    await expect(
      variants.nth(0).getByLabel("Price adjustment (EUR)"),
    ).toHaveValue("0.00");
    await expect(
      variants.nth(0).getByLabel(labels.available, { exact: true }),
    ).toBeChecked();
    await variants.nth(0).getByRole("radio").check();
    await fits(page);
    await variants.nth(0).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `artifacts/menu-editor/variants-${width}.png`,
    });
    await config
      .getByRole("button", { name: `+ ${labels.addGroup}`, exact: true })
      .click();
    const group = config.locator(
      ".configuration-card:not(.configuration-variant)",
    );
    const groupText = group.locator(":scope > .menu-translation-editor");
    await groupText
      .getByLabel("Name · English", { exact: true })
      .fill("Extras");
    await copy(groupText).click();
    const option = group.locator(".configuration-option");
    await option
      .getByLabel("Name · English", { exact: true })
      .fill("Mozzarella");
    await copy(option).click();
    await option.getByLabel("Price adjustment (EUR)").fill("1.50");
    const configResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/configuration") &&
        response.request().method() === "PUT",
    );
    await config
      .getByRole("button", { name: labels.saveConfiguration })
      .click();
    expect((await configResponse).ok()).toBe(true);
    await expect(config).toHaveCount(0);
    await page.reload();
    await product
      .getByRole("button", { name: labels.configure, exact: true })
      .click();
    await expect(variants).toHaveCount(2);
    await expect(
      variants.nth(1).getByLabel("Price adjustment (EUR)"),
    ).toHaveValue("3.00");
    await expect(
      variants.nth(1).getByLabel(labels.available, { exact: true }),
    ).not.toBeChecked();
    await expect(variants.nth(0).getByRole("radio")).toBeChecked();
    await groupText.locator("summary").click();
    await expect(
      groupText.getByLabel("Name · German", { exact: true }),
    ).toHaveValue("Extras");
    await option.locator("summary").click();
    await expect(
      option.getByLabel("Name · Italian", { exact: true }),
    ).toHaveValue("Mozzarella");
    await expect(option.getByLabel("Price adjustment (EUR)")).toHaveValue(
      "1.50",
    );
    for (const [index, name] of ["30 cm", "40 cm"].entries()) {
      await variants.nth(index).locator("summary").click();
      for (const language of Object.values(labels.languages)) {
        await expect(
          variants.nth(index).getByLabel(`Name · ${language}`, { exact: true }),
        ).toHaveValue(name);
      }
    }
  });
}

test("each panel locale is the primary editing language", async ({ page }) => {
  for (const [locale, dictionary] of Object.entries({ en, de, it, sq })) {
    const words = dictionary.menuAdmin;
    await page.goto(`/${locale}/staff/menu`);
    await page
      .getByRole("button", { name: `+ ${words.addCategory}`, exact: true })
      .click();
    const form = page.locator(".menu-editor-form");
    await expect(form.getByRole("textbox")).toHaveCount(1);
    const language = Object.entries(words.languages).find(
      ([key]) => key === locale,
    )![1];
    await expect(
      form.getByRole("textbox", {
        name: `${words.name} · ${language}`,
        exact: true,
      }),
    ).toBeVisible();
    await form.getByRole("textbox").fill("Coca Cola");
    await form.getByRole("button", { name: words.copyPrimary }).click();
    await form.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(form.getByRole("textbox")).toHaveCount(4);
    for (const input of await form.getByRole("textbox").all())
      await expect(input).toHaveValue("Coca Cola");
    await form.getByRole("button", { name: words.cancel, exact: true }).click();
  }
});

test("sidebar scrollbars are hidden while desktop and drawer remain scrollable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 400 });
  await page.goto("/en/staff/menu");
  const sidebar = page.getByRole("complementary");
  await expect(
    sidebar.getByRole("link", { name: "Home", exact: true }),
  ).toBeVisible();
  const assertScroll = async (container: Locator) => {
    expect(
      await container.evaluate((element) => ({
        scrollbar: getComputedStyle(element).scrollbarWidth,
        horizontal: element.scrollWidth > element.clientWidth,
        scrollable: element.scrollHeight > element.clientHeight,
      })),
    ).toEqual({ scrollbar: "none", horizontal: false, scrollable: true });
    await container.hover();
    await page.mouse.wheel(0, 900);
    await expect
      .poll(() => container.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await fits(page);
  };
  await assertScroll(sidebar);
  await page.setViewportSize({ width: 390, height: 400 });
  const toggle = page.getByRole("button", {
    name: "Expand navigation",
    exact: true,
  });
  await toggle.click();
  const drawer = page.getByRole("dialog");
  await assertScroll(drawer);
  await drawer.getByRole("link", { name: "Home", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(toggle).toBeFocused();
});
