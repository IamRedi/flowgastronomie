import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
const api = "http://localhost:4300";
async function saved(page: Page) {
  await expect(page.locator(".v2-statusbar [role=status]")).toHaveText("Saved");
}
async function tools(page: Page) {
  if (!(await page.locator("#website-context-tools").count()))
    await page
      .locator(".builder-toolbar")
      .getByRole("button", { name: "Settings & history", exact: true })
      .click();
}

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
  for (const [name, value] of Object.entries({
    organizationName: "Premium owner acceptance",
    venueName: "Owner's fresh pizzeria",
    ownerDisplayName: "Acceptance owner",
    email: `${randomUUID()}@premium.test`,
    password: "premium-acceptance-password",
  }))
    await page.locator(`input[name="${name}"]`).fill(value);
  await page.locator('select[name="plan"]').selectOption("RESTAURANT_PRO");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".signup-review")).toContainText("Germany");
  await page.screenshot({
    path: "artifacts/setup/premium-signup-review.png",
    fullPage: true,
  });
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith("/v1/public/trials") && r.request().method() === "POST",
    { timeout: 20000 },
  );
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  expect((await created).ok()).toBe(true);
  await page.waitForURL(/\/app\/en\/onboarding/, { timeout: 20000 });
  const getWebsite = async () =>
    (await page.request.get(`${api}/v1/workspace/website`)).json();
  const getMenu = async () =>
    (await page.request.get(`${api}/v1/staff/menu?locale=en`)).json();
  const getMedia = async () =>
    (await page.request.get(`${api}/v1/workspace/media`)).json();
  const signup = await getWebsite(),
    menuBefore = await getMenu(),
    mediaBefore = await getMedia();
  const photoBefore = await page.request.get(
    `${api}${mediaBefore.products[0].media.url}`,
  );
  expect(photoBefore.ok()).toBe(true);
  const originalBytes = await photoBefore.body();
  expect(signup).toMatchObject({
    premiumStyleId: "pizzeria-2",
    status: "DRAFT",
    openingHours: [],
  });
  await page.goto("/app/en/website");
  // The current studio replaces the retired named-select form. Keep real UI edits.
  await expect(page.getByRole("radio")).toHaveCount(3);
  expect(
    await page
      .getByRole("radio")
      .first()
      .evaluate((e) => e.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: /Create my website/ }).click();
  await saved(page);
  const before = await getWebsite();
  expect(before.designVersion).toBe(2);
  expect(before.premiumStyleId).toBe("pizzeria-2");
  await tools(page);
  await page
    .locator("#website-context-tools")
    .getByRole("button", { name: "Change style", exact: true })
    .click();
  await page.getByRole("radio").nth(2).click();
  await page.getByRole("button", { name: /Apply this look/ }).click();
  await saved(page);
  expect((await getWebsite()).premiumStyleId).toBe("pizzeria-3");
  // History records the content BEFORE each change; capture the exact style event.
  const revisions = await (
    await page.request.get(`${api}/v1/staff/website-history`)
  ).json();
  const restoreRevisionId = revisions[0].id as string;
  const title = page.locator(".ws-hero h1 [contenteditable]");
  await title.fill("Owner approved heading");
  await page.locator(".builder-toolbar h1").click();
  await saved(page);
  const currentTitle = async () =>
    (await getWebsite()).translations.find(
      (t: { locale: string }) => t.locale === "en",
    ).heroTitle;
  await expect.poll(currentTitle).toBe("Owner approved heading");
  expect(await getWebsite()).toMatchObject({
    premiumStyleId: "pizzeria-3",
    status: "DRAFT",
    openingHours: [],
  });
  await page.screenshot({
    path: "artifacts/setup/premium-owner-saved.png",
    fullPage: true,
  });
  await page.route("**/v1/workspace/website", (route) =>
    route.request().method() === "PUT" ? route.abort() : route.continue(),
  );
  await title.fill("Unsaved recovery text");
  await page.locator(".builder-toolbar h1").click();
  await expect(page.locator(".v2-statusbar [role=status]")).toContainText(
    "Offline",
  );
  await expect(title).toHaveText("Unsaved recovery text");
  await expect(
    page.getByRole("button", { name: "Retry save", exact: true }),
  ).toBeEnabled();
  expect(await currentTitle()).toBe("Owner approved heading");
  await page.unroute("**/v1/workspace/website");
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await saved(page);
  await expect.poll(currentTitle).toBe("Unsaved recovery text");
  const concurrent = await getWebsite();
  const competing = structuredClone(concurrent.document);
  competing.sections[0].content.find(
    (t: { locale: string }) => t.locale === "en",
  ).title = "Other session edit";
  const competingTranslations = concurrent.translations.map(
    (translation: { locale: string; heroTitle: string }) =>
      translation.locale === "en"
        ? { ...translation, heroTitle: "Other session edit" }
        : translation,
  );
  const changed = await page.request.put(`${api}/v1/workspace/website`, {
    data: {
      ...concurrent,
      document: competing,
      translations: competingTranslations,
      expectedUpdatedAt: concurrent.updatedAt,
    },
  });
  await expect(changed).toBeOK();
  await title.fill("Owner approved heading");
  await page.locator(".builder-toolbar h1").click();
  await expect(page.locator(".v2-statusbar [role=status]")).toContainText(
    "Another session",
  );
  await expect(title).toHaveText("Owner approved heading");
  expect(await currentTitle()).toBe("Other session edit");
  await page.screenshot({
    path: "artifacts/setup/premium-owner-conflict.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Keep my changes", exact: true })
    .click();
  await saved(page);
  await expect.poll(currentTitle).toBe("Owner approved heading");
  await page.goto("/app/en/website/preview");
  await expect(page.locator(".website-sections")).toHaveClass(
    /design-heritage/,
  );
  await expect(page.locator(".website-sections h1")).toHaveText(
    "Owner approved heading",
  );
  await expect(page.locator(".ws-products article").first()).toBeVisible();
  const productPhotos = page.locator('.ws-products img[src*="/v1/"]');
  await expect(productPhotos).toHaveCount(2);
  // Heritage intentionally hides menu figures; asset access must remain intact.
  await expect(productPhotos.first()).toBeHidden();
  for (const photo of await productPhotos.all()) {
    const response = await page.request.get((await photo.getAttribute("src"))!);
    await expect(response).toBeOK();
    expect((await response.body()).length).toBeGreaterThan(0);
  }
  await page.goto("/app/en/website");
  await tools(page);
  await page.getByText("Restore an earlier draft", { exact: true }).click();
  await page
    .locator(".website-draft-history select")
    .selectOption(restoreRevisionId);
  await expect(
    page.getByRole("button", { name: "Restore", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel(
      "I confirm replacing website text and style with this revision. Menu and original photos are preserved.",
    )
    .check();
  const reverted = page.waitForResponse(
    (r) =>
      r.url().endsWith("/v1/staff/website-history/revert") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  expect((await reverted).ok()).toBe(true);
  await expect
    .poll(async () => (await getWebsite()).document)
    .toEqual(before.document);
  const restored = await getWebsite();
  expect(restored.premiumStyleId).toBe("pizzeria-2");
  expect(restored.translations).toEqual(before.translations);
  expect(restored.status).toBe("DRAFT");
  expect(await getMenu()).toEqual(menuBefore);
  expect(await getMedia()).toEqual(mediaBefore);
  const photoAfter = await page.request.get(
    `${api}${mediaBefore.products[0].media.url}`,
  );
  expect(photoAfter.ok()).toBe(true);
  expect(await photoAfter.body()).toEqual(originalBytes);
  await expect(title).toHaveText(
    before.document.sections[0].content.find(
      (t: { locale: string }) => t.locale === "en",
    ).title,
  );
  await tools(page);
  await expect(
    page
      .locator("#website-context-tools")
      .getByRole("button", { name: "AI", exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".builder-toolbar")
      .getByRole("button", { name: "Settings & history", exact: true })
      .evaluate((e) => e.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  await page.screenshot({
    path: "artifacts/setup/premium-owner-mobile.png",
    fullPage: true,
  });
});
