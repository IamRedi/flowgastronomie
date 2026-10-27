import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
const api = "http://localhost:4300";

test("premium signup, owner edit, preview and confirmed restore use canonical drafts", async ({
  page,
}) => {
  test.skip(
    process.env.SETUP_LOCAL_REVIEW === "true",
    "Isolated acceptance only",
  );
  await page.goto("/en/signup?profile=PIZZERIA&style=pizzeria-2");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator('input[name="sampleMenu"]').check();
  await page.locator('input[name="confirmTemplate"]').check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator('select[name="countryCode"]').selectOption("DE");
  await expect(page.locator('select[name="currency"]')).toHaveValue("EUR");
  await expect(page.locator('select[name="timezone"]')).toHaveValue(
    "Europe/Berlin",
  );
  const fields = {
    organizationName: "Premium owner acceptance",
    venueName: "Owner's fresh pizzeria",
    ownerDisplayName: "Acceptance owner",
    email: `${randomUUID()}@premium.test`,
    password: "premium-acceptance-password",
  };
  for (const [name, value] of Object.entries(fields))
    await page.locator(`input[name="${name}"]`).fill(value);
  await page.locator('select[name="plan"]').selectOption("RESTAURANT_PRO");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".signup-review")).toContainText("Germany");
  await page.screenshot({
    path: "artifacts/setup/premium-signup-review.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/en\/onboarding/);
  const getWebsite = async () =>
    (await page.request.get(`${api}/v1/workspace/website`)).json();
  const before = await getWebsite();
  const getMenu = async () =>
    (await page.request.get(`${api}/v1/staff/menu?locale=en`)).json();
  const getMedia = async () =>
    (await page.request.get(`${api}/v1/workspace/media`)).json();
  const menuBefore = await getMenu();
  const mediaBefore = await getMedia();
  const photoBefore = await page.request.get(
    `${api}${mediaBefore.products[0].media.url}`,
  );
  expect(photoBefore.ok()).toBe(true);
  const originalBytes = await photoBefore.body();
  expect(before).toMatchObject({
    premiumStyleId: "pizzeria-2",
    status: "DRAFT",
    openingHours: [],
  });
  await page.goto("/app/en/website");
  expect(
    await page
      .locator('select[name="premiumStyleId"]')
      .evaluate((element) => element.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  await page
    .locator('select[name="premiumStyleId"]')
    .selectOption("pizzeria-3");
  await page
    .locator('input[name="heroTitle-en"]')
    .fill("Owner approved heading");
  await page.getByRole("button", { name: "Save website", exact: true }).click();
  await expect(page.getByText("Website saved successfully.")).toBeVisible();
  const saved = await getWebsite();
  expect(saved).toMatchObject({
    premiumStyleId: "pizzeria-3",
    status: "DRAFT",
    openingHours: [],
  });
  expect(
    saved.translations.find((t: { locale: string }) => t.locale === "en")
      .heroTitle,
  ).toBe("Owner approved heading");
  await page.screenshot({
    path: "artifacts/setup/premium-owner-saved.png",
    fullPage: true,
  });
  // A failed network request and a stale draft must keep entered text and release the busy state.
  const titleInput = page.locator('input[name="heroTitle-en"]');
  await titleInput.fill("Unsaved recovery text");
  await page.route("**/v1/workspace/website", async (route) => {
    if (route.request().method() === "PUT") await route.abort();
    else await route.continue();
  });
  await page.getByRole("button", { name: "Save website", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save website", exact: true }),
  ).toBeEnabled();
  await expect(titleInput).toHaveValue("Unsaved recovery text");
  await page.unroute("**/v1/workspace/website");
  await page.route("**/v1/workspace/website", async (route) => {
    if (route.request().method() === "PUT")
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ code: "WEBSITE_DRAFT_CONFLICT" }),
      });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Save website", exact: true }).click();
  await expect(
    page.getByText(/This draft changed in another session/),
  ).toBeVisible();
  await expect(titleInput).toHaveValue("Unsaved recovery text");
  await page.unroute("**/v1/workspace/website");
  await titleInput.fill("Owner approved heading");
  await page.screenshot({
    path: "artifacts/setup/premium-owner-conflict.png",
    fullPage: true,
  });
  await page.goto("/app/en/website/preview");
  await expect(page.locator(".premium-site")).toHaveClass(/premium-heritage/);
  await expect(page.locator(".premium-site h1")).toHaveText(
    "Owner approved heading",
  );
  await expect(page.locator(".premium-products article").first()).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".premium-hero-image img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  const productPhotos = page.locator('.premium-products img[src*="/v1/"]');
  await expect(productPhotos).toHaveCount(2);
  await productPhotos.first().scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      productPhotos
        .first()
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.goto("/app/en/website");
  await page.getByText("Restore an earlier draft", { exact: true }).click();
  await expect
    .poll(() => page.locator(".website-draft-history select option").count())
    .toBeGreaterThan(1);
  await page
    .locator(".website-draft-history select")
    .selectOption({ index: 1 });
  await expect(
    page.getByRole("button", { name: "Restore", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel(
      "I confirm replacing website text and style with this revision. Menu and original photos are preserved.",
    )
    .check();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.locator('select[name="premiumStyleId"]')).toHaveValue(
    "pizzeria-2",
  );
  const restored = await getWebsite();
  expect(restored.translations).toEqual(before.translations);
  expect(restored.status).toBe("DRAFT");
  expect(await getMenu()).toEqual(menuBefore);
  expect(await getMedia()).toEqual(mediaBefore);
  const photoAfter = await page.request.get(
    `${api}${mediaBefore.products[0].media.url}`,
  );
  expect(photoAfter.ok()).toBe(true);
  expect(await photoAfter.body()).toEqual(originalBytes);
  await page.locator(".website-copy-import summary").click();
  await expect(
    page.getByRole("button", { name: "Read website", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("AI is not configured. You can edit all fields manually."),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".website-copy-import summary")
      .evaluate((element) => element.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  await page.screenshot({
    path: "artifacts/setup/premium-owner-mobile.png",
    fullPage: true,
  });
});
