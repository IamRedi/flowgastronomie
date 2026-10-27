import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { businessImportCopy } from "../../apps/web/app/app/[lang]/onboarding/business-import/import-copy";
const api = "http://localhost:4302";
test("uploaded PDF/photo review survives canonical conflicts and resumes with renewed approvals", async ({
  page,
}) => {
  const words = businessImportCopy("en");
  const owner = JSON.parse(
    await readFile("artifacts/import-v2/owners.json", "utf8"),
  ).find((row: { locale: string }) => row.locale === "en");
  const login = await page.request.post(`${api}/v1/auth/login`, {
    data: {
      tenantSlug: owner.tenantSlug,
      venueSlug: owner.venueSlug,
      email: owner.email,
      password: owner.password,
    },
  });
  expect(login.ok()).toBe(true);
  await page.goto("/app/en/onboarding/business-import");
  await page.getByLabel(words.authorize, { exact: true }).check();
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/v1/staff/business-imports",
  );
  await page.getByRole("button", { name: words.start }).click();
  const response = await created;
  expect(
    response.ok(),
    `import creation HTTP status ${response.status()}`,
  ).toBe(true);
  await page
    .getByLabel(words.upload, { exact: true })
    .setInputFiles([
      "artifacts/import-v2/text-menu.pdf",
      "artifacts/import-v2/menu.png",
    ]);
  await expect(page.getByText("menu.png", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: words.analyze, exact: false }).click();
  await expect(page.locator(".bi-product")).toHaveCount(4);
  await page
    .getByLabel(words.fields.venueName, { exact: true })
    .fill("Reviewed file business");
  await page
    .locator('.bi-field[data-field="venueName"]')
    .getByRole("button", { name: words.accept })
    .click();
  await page.getByRole("button", { name: words.save, exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(words.savedReview);
  const editor = await (
    await page.request.get(`${api}/v1/workspace/website`)
  ).json();
  const change = await page.request.put(`${api}/v1/workspace/website`, {
    data: {
      ...editor,
      expectedUpdatedAt: editor.updatedAt,
      phone: "+49 30 555 999",
    },
  });
  expect(change.ok()).toBe(true);
  await page.getByRole("button", { name: words.save, exact: true }).click();
  await expect(page.locator(".bi-alert")).toContainText(words.conflict);
  await expect(
    page.getByLabel(words.fields.venueName, { exact: true }),
  ).toHaveValue("Reviewed file business");
  await page.getByRole("button", { name: words.reload, exact: true }).click();
  await expect(
    page.locator('.bi-field[data-field="venueName"]'),
  ).toHaveAttribute("data-decision", "PENDING");
  await page.getByRole("button", { name: words.save, exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(words.savedReview);
  await expect(page.locator(".bi-alert")).toHaveCount(0);
});
for (const locale of ["sq", "de", "en", "it"] as const)
  test(`${locale}: URL → saved review → canonical draft → preview → safe restore`, async ({
    page,
  }) => {
    const words = businessImportCopy(locale);
    const owners = JSON.parse(
      await readFile("artifacts/import-v2/owners.json", "utf8"),
    );
    const owner = owners.find(
      (row: { locale: string }) => row.locale === locale,
    );
    const login = await page.request.post(`${api}/v1/auth/login`, {
      data: {
        tenantSlug: owner.tenantSlug,
        venueSlug: owner.venueSlug,
        email: owner.email,
        password: owner.password,
      },
    });
    expect(login.ok()).toBe(true);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/app/${locale}/onboarding/business-import`);
    await page
      .getByLabel(words.url, { exact: true })
      .fill("https://bistro.example.com");
    await page.getByLabel(words.authorize, { exact: true }).check();
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/staff/business-imports",
    );
    await page.getByRole("button", { name: words.start }).click();
    const response = await created;
    expect(
      response.ok(),
      `import creation HTTP status ${response.status()}`,
    ).toBe(true);
    await page
      .getByRole("button", { name: words.analyze, exact: false })
      .click();
    await expect(page.locator(".bi-fields")).toBeVisible({ timeout: 60000 });
    const importUrl = page.url();
    const id = new URL(importUrl).searchParams.get("import")!;
    const view = await (
      await page.request.get(`${api}/v1/staff/business-imports/${id}`)
    ).json();
    for (const field of new Set(
      view.businessData.fields.map((p: { field: string }) => p.field),
    ))
      await page
        .locator(`.bi-field[data-field="${field}"]`)
        .getByRole("button", { name: words.accept })
        .click();
    await page
      .getByLabel(words.fields.venueName, { exact: true })
      .fill(`Garden Bistro ${locale.toUpperCase()}`);
    await page
      .locator('.bi-field[data-field="venueName"]')
      .getByRole("button", { name: words.accept })
      .click();
    const products = page.locator(".bi-product");
    expect(await products.count()).toBe(2);
    for (let index = 0; index < 2; index++) {
      const row = products.nth(index);
      await row
        .getByLabel(words.name, { exact: true })
        .fill(`Garden dish ${locale} ${index + 1}`);
      await row
        .getByLabel(words.price, { exact: true })
        .fill(index === 0 ? "9.50" : "7.00");
      await row.getByLabel(words.action, { exact: true }).selectOption("ADD");
      await row.getByLabel(words.acknowledge, { exact: true }).check();
      await row.getByLabel(words.priceApproval, { exact: true }).check();
      await row
        .getByLabel(words.configurationApproval, { exact: true })
        .check();
    }
    await page.getByRole("button", { name: words.save, exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(words.savedReview);
    await page.reload();
    await expect(
      page.getByLabel(words.fields.venueName, { exact: true }),
    ).toHaveValue(`Garden Bistro ${locale.toUpperCase()}`);
    await page.goto(`/app/${locale}/onboarding`);
    await expect(page).toHaveURL(importUrl);
    await expect(
      page.getByLabel(words.fields.venueName, { exact: true }),
    ).toHaveValue(`Garden Bistro ${locale.toUpperCase()}`);
    await page.locator(".bi-style").nth(2).click();
    const photo = page.locator(".bi-photo").first();
    await photo.getByLabel(words.rights, { exact: true }).check();
    await photo
      .getByRole("button", { name: words.importImage, exact: true })
      .click();
    await expect(photo.locator("img")).toBeVisible();
    await photo.getByLabel(words.useImage, { exact: true }).check();
    await photo.getByLabel(words.role, { exact: true }).selectOption("HERO");
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: `artifacts/import-v2/${locale}-review-${width}.png`,
        fullPage: true,
        style: "nextjs-portal{display:none!important}",
      });
    }
    await page.getByLabel(words.confirm, { exact: true }).check();
    await page.getByRole("button", { name: words.draft, exact: false }).click();
    await expect(page.getByRole("heading", { name: words.saved })).toBeVisible({
      timeout: 30000,
    });
    const committed = await (
      await page.request.get(`${api}/v1/staff/business-imports/${id}`)
    ).json();
    expect(committed.canonical.website.status).toBe("DRAFT");
    expect(
      committed.canonical.products.every(
        (p: { published: boolean; available: boolean }) =>
          !p.published && !p.available,
      ),
    ).toBe(true);
    await page.getByRole("link", { name: words.preview }).click();
    await expect(page.locator(".premium-site")).toContainText(
      `Garden dish ${locale} 1`,
    );
    await page.screenshot({
      path: `artifacts/import-v2/${locale}-preview-1440.png`,
      fullPage: true,
      style: "nextjs-portal{display:none!important}",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `artifacts/import-v2/${locale}-preview-390.png`,
      fullPage: true,
      style: "nextjs-portal{display:none!important}",
    });
    await page.goto(importUrl);
    await page.getByText(words.revert, { exact: true }).first().click();
    await page.getByLabel(words.revertConfirm, { exact: true }).check();
    await page.getByRole("button", { name: words.revert, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: words.reverted }),
    ).toBeVisible();
    const menu = await (await page.request.get(`${api}/v1/staff/menu`)).json();
    expect(
      menu.categories.flatMap((c: { products: unknown[] }) => c.products),
    ).toHaveLength(0);
    expect(errors).toEqual([]);
  });
