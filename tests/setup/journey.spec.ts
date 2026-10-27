import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { prisma } from "@flowgastronomie/database";
const api = "http://localhost:4300";
test.afterAll(() => prisma.$disconnect());
for (const previous of [[], ["MEDIA", "TEAM", "MENU"]]) {
  test(`menu skip preserves only explicit skips: ${previous.join(",") || "none"}`, async ({
    page,
  }) => {
    const manifest = JSON.parse(
      await readFile("artifacts/setup/acceptance.json", "utf8"),
    );
    const tenant = manifest.tenants.find(
      (t: { kind: string }) => t.kind === "DEMO",
    );
    const login = await page.request.post(`${api}/v1/auth/login`, {
      data: {
        tenantSlug: tenant.tenantSlug,
        venueSlug: tenant.venueSlug,
        email: tenant.email,
        password: tenant.password,
      },
    });
    expect(login.ok()).toBe(true);
    const initial = await (
      await page.request.get(`${api}/v1/staff/smart-setup`)
    ).json();
    const reset = await page.request.put(`${api}/v1/staff/smart-setup`, {
      data: {
        expectedVersion: initial.progress.version,
        profileId: "PIZZERIA",
        applyCategories: false,
        step: 2,
        skipped: previous,
        complete: false,
      },
    });
    expect(reset.ok()).toBe(true);
    await page.goto("/app/en/onboarding");
    await page
      .getByRole("button", { name: "Skip menu import for now" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your draft menu is saved" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Your draft menu is saved" }),
    ).toBeVisible();
    const saved = await (
      await page.request.get(`${api}/v1/staff/smart-setup`)
    ).json();
    expect(saved.progress.status).toBe("READY");
    expect(saved.progress.skipped).toEqual([...new Set([...previous, "MENU"])]);
  });
}
for (const kind of ["DEMO", "REAL"]) {
  test(`${kind}: four-step reviewed import and resume`, async ({ page }) => {
    const manifest = JSON.parse(
      await readFile("artifacts/setup/acceptance.json", "utf8"),
    );
    const tenant = manifest.tenants.find(
      (t: { kind: string }) => t.kind === kind,
    );
    const login = await page.request.post(`${api}/v1/auth/login`, {
      data: {
        tenantSlug: tenant.tenantSlug,
        venueSlug: tenant.venueSlug,
        email: tenant.email,
        password: tenant.password,
      },
    });
    expect(login.ok()).toBe(true);
    const before = await prisma.product.count({
      where: { tenantId: tenant.tenantId },
    });
    await page.goto("/app/en/onboarding");
    // Existing local businesses may already have saved setup progress.
    const setup = await (
      await page.request.get(`${api}/v1/staff/smart-setup`)
    ).json();
    if (setup.progress.step !== 1) {
      await page.request.put(`${api}/v1/staff/smart-setup`, {
        data: {
          expectedVersion: setup.progress.version,
          profileId: "PIZZERIA",
          applyCategories: false,
          step: 1,
          skipped: [],
          complete: false,
        },
      });
      await page.reload();
    }
    await expect(
      page.getByRole("heading", { name: "What kind of business do you run?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Pizzeria Aurora/ }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    if (setup.progress.activeImportSessionId) {
      // Start a fresh request explicitly; don't discard or mutate earlier receipts.
      const created = await page.request.post(`${api}/v1/staff/menu-imports`, {
        data: { requestKey: crypto.randomUUID(), locale: "en" },
      });
      expect(created.ok()).toBe(true);
      await page.reload();
    }
    const [uploadResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          /\/menu-imports\/[^/]+\/sources\?/.test(response.url()),
      ),
      page
        .getByLabel("Upload your menu", { exact: true })
        .setInputFiles(
          `artifacts/setup/controlled-menu.${kind === "DEMO" ? "png" : "pdf"}`,
        ),
    ]);
    expect(uploadResponse.ok()).toBe(true);
    await expect(
      page.getByRole("button", { name: "Find menu items", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Find menu items", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Here is what we found" }),
    ).toBeVisible();
    expect(
      await prisma.product.count({ where: { tenantId: tenant.tenantId } }),
    ).toBe(before);
    const card = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        name: "Margherita test",
        exact: true,
      }),
    });
    const corrected = `Margherita review ${Date.now()}`;
    await card
      .getByRole("textbox", { name: "Product name", exact: true })
      .fill(corrected);
    await card.getByLabel("Price (EUR)", { exact: true }).fill("10.50");
    if (
      await card
        .getByLabel(
          "Create a separate new product. Do not change the existing product.",
        )
        .count()
    )
      await card
        .getByLabel(
          "Create a separate new product. Do not change the existing product.",
        )
        .check();
    await card
      .getByRole("button", { name: "Approve item", exact: true })
      .click();
    await expect(
      page
        .getByRole("article")
        .filter({
          has: page.getByRole("heading", { name: corrected, exact: true }),
        })
        .getByText("Approved", { exact: true }),
    ).toBeVisible();
    const seasonal = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        name: "Seasonal special",
        exact: true,
      }),
    });
    await seasonal
      .getByRole("button", { name: "Reject item", exact: true })
      .click();
    await expect(seasonal.getByText("Rejected", { exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page.getByLabel("Product name", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: corrected, exact: true }),
    ).toBeVisible();
    await expect(page.locator(".setup-source img")).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator(".setup-source img")
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(500);
    await page.screenshot({
      path: `artifacts/setup/${kind.toLowerCase()}-desktop-review.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".smart-setup")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/setup/${kind.toLowerCase()}-mobile-review.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page
      .getByLabel(
        "I have checked the approved names, prices, currency, sizes and extras.",
      )
      .check();
    await page
      .getByRole("button", { name: "Import approved items", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your draft menu is saved" }),
    ).toBeVisible();
    const saved = await (
      await page.request.get(`${api}/v1/staff/smart-setup`)
    ).json();
    const importId = saved.progress.activeImportSessionId;
    const retry = await page.request.post(
      `${api}/v1/staff/menu-imports/${importId}/import`,
      { data: { expectedVersion: 0, confirm: true } },
    );
    expect(retry.ok()).toBe(true);
    expect((await retry.json()).replayed).toBe(true);
    const product = await prisma.product.findFirstOrThrow({
      where: {
        tenantId: tenant.tenantId,
        translations: { some: { name: corrected } },
      },
      include: { allergens: true },
    });
    expect(product.priceMinor).toBe(1050);
    expect(product.published).toBe(false);
    expect(product.available).toBe(false);
    expect(product.allergens).toHaveLength(0);
    expect(
      await prisma.product.count({ where: { tenantId: tenant.tenantId } }),
    ).toBe(before + 1);
    const other = manifest.tenants.find(
      (t: { kind: string }) => t.kind !== kind,
    );
    expect(
      await prisma.product.count({
        where: {
          tenantId: other.tenantId,
          translations: { some: { name: corrected } },
        },
      }),
    ).toBe(0);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Your draft menu is saved" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Finish setup" }).click();
    await expect(
      page.getByRole("button", { name: "Finish setup" }),
    ).toHaveCount(0);
    await page.screenshot({
      path: `artifacts/setup/${kind.toLowerCase()}-complete.png`,
      fullPage: true,
    });
  });
}
