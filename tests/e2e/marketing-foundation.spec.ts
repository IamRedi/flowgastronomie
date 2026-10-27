import { test, expect, type Page } from "./browser-test";
import {
  marketingText,
  marketingSections,
  marketingStarterText,
} from "../../apps/web/lib/marketing-copy";
import { marketingStarterCatalog } from "../../apps/web/lib/marketing-starter-templates";

// Identity fixtures exercise the web permission boundary without creating
// operational records. Domain tests cover the authoritative permission matrix.
async function identity(page: Page, role: string) {
  await page.route("**/v1/staff/me", (route) =>
    route.fulfill({
      json: {
        staff: {
          displayName: "Marketing review",
          email: "review@example.invalid",
          role,
          tenantId: "marketing-review-tenant",
          venueId: "marketing-review-venue",
          venueName: "Osteria · Review fixture",
        },
      },
    }),
  );
}
const localNav = (page: Page) =>
  page.getByRole("navigation", { name: "Marketing", exact: true });
const base = "/app/en/marketing";
const pathFor = (key: string) => (key === "overview" ? base : `${base}/${key}`);
test("preserves the operational Creative Studio link and legacy query views", async ({
  page,
}) => {
  await identity(page, "OWNER");
  await page.goto(`${base}?view=promotions`);
  await expect(page.locator("[data-promotion-starter]")).toHaveCount(8);
  await expect(
    page.getByRole("link", { name: "Open Creative Studio", exact: true }),
  ).toHaveAttribute("href", `${base}/creative`);
  const response = await page.goto(`${base}/unknown-section`);
  // Next's streamed not-found document may already have sent HTTP 200.
  expect(await response?.text()).toContain("This page could not be found.");
  await expect(page.locator(".marketing-workspace")).toHaveCount(0);
});
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function touchTargets(page: Page) {
  const targets = await page
    .locator(
      '.marketing-workspace a, .marketing-workspace button:enabled, .marketing-workspace select, .marketing-dialog button, .marketing-dialog input:not([type="checkbox"]), .marketing-dialog select, .marketing-dialog summary, .marketing-check',
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }),
    );
  expect(
    targets.every((target) => target.width >= 44 && target.height >= 44),
  ).toBe(true);
}
const viewports = [
  { width: 1366, height: 768, touch: false },
  { width: 1024, height: 768, touch: false },
  { width: 1180, height: 820, touch: true },
  { width: 390, height: 844, touch: true },
];
for (const viewport of viewports) {
  test.describe(`${viewport.width}px Marketing`, () => {
    test.use({ viewport, hasTouch: viewport.touch });
    test("starter catalogs, honest analytics, guided previews and keyboard", async ({
      page,
    }) => {
      await identity(page, "MANAGER");
      const mutations: string[] = [];
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (
          request.url().includes("/v1/") &&
          !["GET", "OPTIONS"].includes(request.method())
        )
          mutations.push(request.url());
      });
      await page.goto(base);
      await expect(localNav(page).getByRole("link")).toHaveCount(5);
      await expect(page.locator(".marketing-overview-grid h4")).toHaveText([
        "8 drafts",
        "4 templates",
        "7 templates",
      ]);
      await expect(
        page.getByText("No activity or redemptions yet", { exact: true }),
      ).toBeVisible();
      const primary = page.getByRole("navigation", {
        name: "Operations",
        exact: true,
      });
      if (viewport.width < 761) {
        await page.getByRole("button", { name: "Expand navigation" }).click();
        await expect(primary.locator('[data-primary="marketing"]')).toHaveCount(
          1,
        );
        await primary
          .getByRole("link", { name: "Marketing", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
      } else {
        await expect(primary.locator('[data-primary="marketing"]')).toHaveCount(
          1,
        );
        await page.locator(".app-sidebar-toggle").click();
        expect(
          await primary.evaluate((el) => el.scrollHeight <= el.clientHeight),
        ).toBe(true);
      }
      for (const [index, section] of marketingSections.entries()) {
        const link = localNav(page).getByRole("link", {
          name: marketingText("en").sections[index]!,
          exact: true,
        });
        if (viewport.touch) await link.tap();
        else await link.click();
        await expect(page).toHaveURL(new RegExp(`${pathFor(section)}$`));
        await expect(
          localNav(page).locator('[aria-current="page"]'),
        ).toHaveCount(1);
        await expect(link).toHaveAttribute("aria-current", "page");
        await noOverflow(page);
        await touchTargets(page);
        await expect(
          page.getByRole("button", {
            name: /save|publish|issue|redeem|export|download|generate|activate/i,
          }),
        ).toHaveCount(0);
        await expect(
          page.locator(".marketing-badge").filter({ hasText: /^Active$/i }),
        ).toHaveCount(0);
        if (section === "promotions") {
          await expect(page.locator("[data-promotion-starter]")).toHaveCount(8);
          await expect(
            page.locator("[data-promotion-starter] .marketing-badge"),
          ).toHaveText(Array(8).fill("DRAFT"));
          await expect(
            page.locator('[data-promotion-starter="pizza-tuesday"]'),
          ).toContainText("10% · Pizza category · Tuesday");
          await expect(
            page.locator('[data-promotion-starter="happy-hour"]'),
          ).toContainText("14:00–17:00");
          await expect(
            page.locator('[data-promotion-starter="five-off-thirty"]'),
          ).toContainText("€5 reward · Subtotal ≥ €30");
          await expect(
            page.locator('[data-promotion-starter="dessert-forty"]'),
          ).toContainText("Subtotal ≥ €40");
          await expect(
            page.locator('[data-promotion-starter="milestone-pizza"]'),
          ).toContainText("Every 500th eligible pizza");
          await expect(
            page.locator('[data-promotion-starter="milestone-pizza"]'),
          ).toContainText("NOT OPERATIONAL");
          await expect(
            page.locator('[data-promotion-starter="pizza-tuesday"]'),
          ).toContainText("Needs venue confirmation");
          await expect(
            page.locator('[data-promotion-starter="pizza-tuesday"]'),
          ).toContainText("POS + Online");
        }
        if (section === "gift-cards") {
          await expect(page.locator("[data-gift-starter]")).toHaveCount(4);
          await expect(page.locator("[data-gift-starter] h3")).toHaveText([
            "€25 Gift Card",
            "€50 Gift Card",
            "€100 Gift Card",
            "Custom Value Gift Card",
          ]);
          await expect(
            page.locator("[data-gift-starter] .marketing-badge"),
          ).toHaveText(Array(4).fill("TEMPLATE · NOT ISSUED"));
          await expect(
            page.locator('[data-gift-starter="gift-25"]'),
          ).toContainText("Future code / QR — not generated");
          await expect(
            page.locator('[data-gift-starter="gift-25"]'),
          ).toContainText("Future balance — not created");
        }
        if (section === "creative-studio")
          await expect(page.locator("[data-creative-starter]")).toHaveCount(7);
        await page.screenshot({
          path: `artifacts/marketing-hub/${section}-${viewport.width}.png`,
          fullPage: true,
          animations: "disabled",
          style: "nextjs-portal{display:none!important}",
        });
      }
      await expect(
        page.locator(".marketing-metrics .marketing-card"),
      ).toHaveCount(5);
      await expect(page.locator(".marketing-metrics")).not.toContainText(
        /€|\b0\b/,
      );
      await localNav(page)
        .getByRole("link", { name: "Promotions", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`${base}/promotions$`));
      for (const starter of marketingStarterCatalog.promotions) {
        const preview = page.getByRole("button", {
          name: `Preview: ${starter.name}`,
          exact: true,
        });
        await preview.click();
        await expect(
          page.getByRole("dialog", { name: starter.name, exact: true }),
        ).toContainText("DRAFT · NOT OPERATIONAL");
        await expect(page.getByRole("dialog")).toContainText(
          starter.plannedRule.en,
        );
        await page.keyboard.press("Escape");
        await expect(preview).toBeFocused();
      }
      const newPromotion = page.getByRole("button", {
        name: "New promotion",
        exact: true,
      });
      await newPromotion.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", {
        name: "New promotion",
        exact: true,
      });
      await expect(dialog).toContainText("Nothing is saved");
      await expect(
        dialog.getByLabel("Starts", { exact: true }),
      ).not.toBeVisible();
      await dialog
        .getByLabel("Campaign name", { exact: true })
        .fill("Lunch idea");
      await dialog
        .getByRole("combobox", { name: "Type", exact: true })
        .selectOption("3");
      await dialog.getByText("Channels and dates", { exact: true }).click();
      await dialog.getByLabel("Starts", { exact: true }).fill("2026-11-01");
      await dialog.getByLabel("Ends", { exact: true }).fill("2026-11-15");
      await dialog.getByLabel("POS enabled", { exact: true }).check();
      await noOverflow(page);
      await touchTargets(page);
      await page.screenshot({
        path: `artifacts/marketing-hub/promotion-form-${viewport.width}.png`,
        animations: "disabled",
        style: "nextjs-portal{display:none!important}",
      });
      await dialog.getByRole("button", { name: "Preview plan" }).click();
      await expect(
        dialog.getByRole("heading", { name: "Your promotion plan" }),
      ).toBeFocused();
      await expect(dialog).toContainText("Lunch idea");
      await expect(dialog).toContainText("Buy X Get Y");
      await expect(dialog).toContainText("Not enabled");
      await page.keyboard.press("Escape");
      await expect(newPromotion).toBeFocused();
      await newPromotion.click();
      await expect(
        dialog.getByLabel("Campaign name", { exact: true }),
      ).toHaveValue("");
      // Native dialog contains Tab navigation and restores the launching control.
      await dialog.getByRole("button", { name: "Preview plan" }).focus();
      await page.keyboard.press("Tab");
      await expect(
        dialog.getByRole("button", { name: "Close", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(newPromotion).toBeFocused();
      await localNav(page)
        .getByRole("link", { name: "Gift Cards", exact: true })
        .click();
      await page
        .getByRole("button", { name: "New Gift Card", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toContainText(
        "it is not a discount",
      );
      await expect(page.getByRole("dialog").locator("input")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await localNav(page)
        .getByRole("link", { name: "Creative Studio", exact: true })
        .click();
      for (const starter of marketingStarterCatalog.creative) {
        const button = page.locator(`[data-creative-starter="${starter.key}"]`);
        await button.click();
        await expect(button).toHaveAttribute("aria-pressed", "true");
        await expect(
          page.locator(".marketing-preview [role='status']"),
        ).toContainText(`Template preview · ${starter.name.en}`);
        await expect(page.locator(".marketing-template")).toContainText(
          starter.source.kind === "gift-card"
            ? "NOT ISSUED"
            : "NOT OPERATIONAL",
        );
        await expect(page.locator(".marketing-template")).toContainText(
          "Osteria · Review fixture",
        );
        await noOverflow(page);
      }
      await page.screenshot({
        path: `artifacts/marketing-hub/template-${viewport.width}.png`,
        fullPage: true,
        animations: "disabled",
        style: "nextjs-portal{display:none!important}",
      });
      await expect(
        page.getByRole("button", {
          name: /save|publish|issue|redeem|export|download|generate|activate/i,
        }),
      ).toHaveCount(0);
      expect(mutations).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}
for (const role of ["OWNER", "MANAGER", "WAITER", "BAR", "KITCHEN"]) {
  test(`${role} sidebar visibility and direct Marketing URLs`, async ({
    page,
  }) => {
    await identity(page, role);
    const allowed = role === "OWNER" || role === "MANAGER";
    for (const section of marketingSections) {
      await page.goto(pathFor(section));
      await expect(
        page.getByRole("navigation", { name: "Operations" }),
      ).toBeVisible();
      await expect(page.locator('[data-primary="marketing"]')).toHaveCount(
        allowed ? 1 : 0,
      );
      await expect(localNav(page)).toHaveCount(allowed ? 1 : 0);
      if (!allowed) {
        await expect(
          page.getByText("Marketing is available to Owners and Managers."),
        ).toBeVisible();
        await expect(page.locator(".marketing-workspace button")).toHaveCount(
          0,
        );
      }
    }
  });
}
test("anonymous Marketing entry returns to staff login", async ({ page }) => {
  await page.route("**/v1/staff/me", (route) =>
    route.fulfill({ status: 401, json: { error: "UNAUTHORIZED" } }),
  );
  await page.goto(`${base}/gift-cards`);
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/en/staff/login" &&
      url.searchParams.get("next") === `${base}/gift-cards`,
    { timeout: 30_000 },
  );
  await expect(localNav(page)).toHaveCount(0);
});
for (const locale of ["en", "de", "it", "sq"] as const) {
  test(`${locale} localizes every starter section and visible state`, async ({
    page,
  }) => {
    await identity(page, "MANAGER");
    const words = marketingStarterText(locale);
    await page.goto(`/app/${locale}/marketing`);
    await expect(
      page.getByRole("heading", { name: marketingText(locale).intro }),
    ).toBeVisible();
    await expect(localNav(page).getByRole("link")).toHaveCount(5);
    await expect(page.locator(".marketing-overview-grid h4")).toHaveText([
      `8 ${words.drafts}`,
      `4 ${words.templates}`,
      `7 ${words.templates}`,
    ]);
    await page.goto(`/app/${locale}/marketing/promotions`);
    await expect(
      page.locator("[data-promotion-starter] .marketing-badge"),
    ).toHaveText(Array(8).fill(words.draft));
    await expect(
      page.locator('[data-promotion-starter="pizza-tuesday"]'),
    ).toContainText(words.confirmation);
    await expect(
      page.locator('[data-promotion-starter="happy-hour"]'),
    ).toContainText(marketingStarterCatalog.promotions[1]!.plannedRule[locale]);
    await page.goto(`/app/${locale}/marketing/gift-cards`);
    await expect(
      page.locator("[data-gift-starter] .marketing-badge"),
    ).toHaveText(Array(4).fill(`${words.template} · ${words.notIssued}`));
    for (const starter of marketingStarterCatalog.giftCards) {
      const card = page.locator(`[data-gift-starter="${starter.key}"]`);
      await expect(card).toContainText(starter.name[locale]);
      await expect(card).toContainText(words.futureCode);
      await expect(card).toContainText(words.futureBalance);
      await card.getByRole("button").click();
      await expect(page.getByRole("dialog")).toContainText(words.notIssued);
      await expect(page.getByRole("dialog").locator("input")).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
    await page.goto(`/app/${locale}/marketing/creative-studio`);
    await expect(page.locator("[data-creative-starter]")).toHaveCount(7);
    for (const starter of marketingStarterCatalog.creative)
      await expect(
        page.locator(`[data-creative-starter="${starter.key}"]`),
      ).toContainText(starter.name[locale]);
    await page.goto(`/app/${locale}/marketing/analytics`);
    await expect(
      page.locator(".marketing-metrics .marketing-card p"),
    ).toHaveText(Array(5).fill(words.noData));
    await expect(
      page.locator(
        ".marketing-metrics svg:not(.pilot-icon), .marketing-metrics canvas",
      ),
    ).toHaveCount(0);
    await expect(page.locator(".marketing-metrics")).not.toContainText(
      /€|[0-9]/,
    );
  });
}
test("unknown Marketing paths render not-found", async ({ page }) => {
  await identity(page, "MANAGER");
  for (const path of ["unknown", "promotions/unexpected", "overview"]) {
    await page.goto(`${base}/${path}`);
    await expect(
      page.getByRole("heading", { name: "404", exact: true }),
    ).toBeVisible();
    await expect(localNav(page)).toHaveCount(0);
  }
});
