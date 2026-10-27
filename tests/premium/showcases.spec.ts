import { test, expect } from "@playwright/test";
import { premiumCatalog } from "@flowgastronomie/domain";
import { mkdirSync } from "node:fs";

for (const pack of premiumCatalog())
  for (const locale of ["sq", "de", "en", "it"] as const) {
    test(`${pack.profileId} · ${locale} · three responsive styles`, async ({
      page,
    }) => {
      const writes: string[] = [];
      const errors: string[] = [];
      page.on("request", (r) => {
        if (r.method() !== "GET") writes.push(r.url());
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/${locale}/showcase?profile=${pack.profileId}`);
      for (const [index, style] of pack.styles.entries()) {
        await page
          .getByRole("button", { name: style.name, exact: true })
          .click();
        await expect(page.locator(".premium-site")).toHaveClass(
          new RegExp(`premium-${style.layout.toLowerCase()}`),
        );
        await expect(page.locator(".premium-site h1")).toHaveText(
          pack.tagline[locale],
        );
        await expect(page.locator(".premium-products article")).toHaveCount(
          pack.categories.reduce((n, c) => n + c.products.length, 0),
        );
        await expect(page.locator(".premium-products figure")).toHaveCount(
          pack.categories.flatMap((c) => c.products).filter((p) => p.photoKey)
            .length,
        );
        await expect(
          page.locator(".premium-products .text-only figure"),
        ).toHaveCount(0);
        await expect(page.locator(".premium-menu-sections")).not.toContainText(
          /Photo to come|Foto folgt|Foto in arrivo|Foto në vijim|SAMPLE/,
        );
        await expect(page.locator(".premium-disclosure")).toBeVisible();
        for (const width of [360, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          expect(
            await page
              .locator(
                ".premium-products h4, .premium-products p, .premium-products strong",
              )
              .evaluateAll((elements) =>
                elements.every(
                  (element) => element.scrollWidth <= element.clientWidth + 1,
                ),
              ),
          ).toBe(true);
          expect(
            await page
              .locator(".premium-site a")
              .evaluateAll((elements) =>
                elements.every(
                  (element) => element.getBoundingClientRect().height >= 44,
                ),
              ),
          ).toBe(true);
          await page
            .locator(".premium-site img")
            .evaluateAll((images) =>
              images.forEach(
                (img) => ((img as HTMLImageElement).loading = "eager"),
              ),
            );
          await expect
            .poll(() =>
              page
                .locator(".premium-site img")
                .evaluateAll((images) =>
                  images.every(
                    (img) =>
                      (img as HTMLImageElement).complete &&
                      (img as HTMLImageElement).naturalWidth > 0,
                  ),
                ),
            )
            .toBe(true);
          if (width === 360 || width === 1440) {
            mkdirSync("artifacts/premium/menus", { recursive: true });
            await page.locator(".premium-menu").screenshot({
              path: `artifacts/premium/menus/${pack.profileId.toLowerCase()}-${index + 1}-${locale}-${width}.png`,
              animations: "disabled",
              style: "nextjs-portal{display:none!important}",
            });
          }
          if (locale === "de" && (width === 360 || width === 1440)) {
            mkdirSync("artifacts/premium", { recursive: true });
            await page.screenshot({
              path: `artifacts/premium/${pack.profileId.toLowerCase()}-${index + 1}-${width}.png`,
              fullPage: true,
              style: "nextjs-portal{display:none!important}",
            });
          }
        }
        await expect(page.locator(".premium-choose")).toHaveAttribute(
          "href",
          `/${locale}/signup?profile=${pack.profileId}&style=${style.id}`,
        );
      }
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
      await expect(page.locator("body")).not.toContainText(
        /Osteria|Flow Pizzeria Demo/,
      );
    });
  }
test("signup retains selection and requires explicit confirmation; keyboard and language navigation work", async ({
  page,
}) => {
  await page.goto("/en/showcase?profile=ICE_CAFE&style=ice_cafe-2");
  await page
    .locator(".premium-languages")
    .getByRole("link", { name: "SQ" })
    .click();
  await expect(
    page.locator('.premium-style-buttons button[aria-pressed="true"]'),
  ).toHaveText("Pastel Family");
  await page.locator(".premium-choose").click();
  await expect(page.locator('select[name="profileId"]')).toHaveValue(
    "ICE_CAFE",
  );
  await page.getByRole("button", { name: "Vazhdo", exact: true }).click();
  await expect(page.locator('input[name="confirmTemplate"]')).toHaveAttribute(
    "required",
    "",
  );
  await expect(page.locator('input[name="sampleMenu"]')).not.toBeChecked();
  await page.goto("/en/showcase");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("A");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".premium-site")).toBeVisible();
});

for (const [country, currency, timezone] of [
  ["DE", "EUR", "Europe/Berlin"],
  ["AL", "ALL", "Europe/Tirane"],
  ["US", "USD", "America/New_York"],
]) {
  test(`onboarding region ${country} is explicit, editable and reviewed`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/sq/signup");
    await page.getByRole("button", { name: "Vazhdo", exact: true }).click();
    await page.getByRole("button", { name: "Vazhdo", exact: true }).click();
    await expect(page.locator('select[name="countryCode"]')).toHaveValue("");
    await expect(page.locator('select[name="currency"]')).toHaveValue("");
    await page.locator('select[name="countryCode"]').selectOption(country!);
    if (country === "US") {
      await expect(page.locator('select[name="currency"]')).toHaveValue("");
      await page.locator('select[name="currency"]').selectOption(currency!);
      await page.locator('select[name="timezone"]').selectOption(timezone!);
    }
    await expect(page.locator('select[name="currency"]')).toHaveValue(
      currency!,
    );
    await expect(page.locator('select[name="timezone"]')).toHaveValue(
      timezone!,
    );
    expect(errors).toEqual([]);
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  });
}
