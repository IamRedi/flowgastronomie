import { test, expect, type Page } from "./browser-fixture";
import sharp from "sharp";
import { websiteV2Copy } from "../../apps/web/components/website-v2-copy";
import { businessImportCopy } from "../../apps/web/app/app/[lang]/onboarding/business-import/import-copy";
import { compactCopy } from "../../apps/web/app/app/[lang]/onboarding/business-import/compact-copy";
const api = "http://localhost:4302";
async function login(page: Page, locale = "en") {
  expect(
    (
      await page.request.post(`${api}/v1/auth/login`, {
        data: {
          email: `website-${locale}@import-v2.example`,
          password: "import-v2-acceptance-password",
        },
      })
    ).ok(),
  ).toBe(true);
}
async function saved(page: Page) {
  await expect(page.locator(".v2-statusbar [role=status]")).toHaveText("Saved");
}
async function current(page: Page) {
  return (await page.request.get(`${api}/v1/workspace/website`)).json();
}
async function openTool(page: Page, name: string) {
  if (!(await page.locator("#website-context-tools").count())) {
    await page
      .locator(".builder-toolbar")
      .getByRole("button", { name: "Settings & history", exact: true })
      .click();
  }
  await page
    .locator("#website-context-tools")
    .getByRole("button", { name, exact: true })
    .click();
}
test("V2 complete visual studio: template, canonical content, resilient edits, reviewed AI and publication", async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  await login(page);
  let aiCalls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/website-ai/propose") && r.method() === "POST")
      aiCalls++;
  });
  await page.goto("/app/en/website");
  await expect(page.getByRole("radio")).toHaveCount(3);
  await expect(
    page.locator(".v2-template-option .design-urban .ws-hero p"),
  ).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.getByRole("radio").first()).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.screenshot({
    path: "artifacts/import-v2/v2-template-selection.png",
    timeout: 15000,
  });
  await page.getByRole("button", { name: /Create my website/ }).click();
  await expect(page.locator(".builder-controls")).toHaveCount(0);
  await saved(page);
  const template = await current(page);
  expect(template.designVersion).toBe(2);
  expect(template.businessProfileId).toBe("CAFE");
  expect(template.document.sections).toHaveLength(5);
  expect(aiCalls).toBe(0);
  expect(JSON.stringify(template.document)).not.toContain("demo:");
  expect(
    (await (await page.request.get(`${api}/v1/staff/menu`)).json()).categories,
  ).toHaveLength(0);
  const title = page.locator(".ws-hero h1 [contenteditable]");
  await title.fill("My confirmed cafe");
  await page.locator(".builder-toolbar h1").click();
  await saved(page);
  expect(
    (await current(page)).document.sections[0].content.find(
      (t: any) => t.locale === "en",
    ).title,
  ).toBe("My confirmed cafe");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await saved(page);
  await expect(title).toHaveText("Garden fixture en");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await saved(page);
  await expect(title).toHaveText("My confirmed cafe");
  // Lost save response is reconciled with the actual committed content.
  let lost = false;
  await page.route("**/v1/workspace/website", async (route) => {
    if (route.request().method() === "PUT" && !lost) {
      lost = true;
      await route.fetch();
      await route.abort("connectionfailed");
    } else await route.continue();
  });
  await title.fill("Recovered committed edit");
  await page.locator(".builder-toolbar h1").click();
  await saved(page);
  expect(lost).toBe(true);
  await page.unroute("**/v1/workspace/website");
  // Draft stays cached across refresh while saves are unavailable.
  await page.route("**/v1/workspace/website", (route) =>
    route.request().method() === "PUT"
      ? route.abort("connectionfailed")
      : route.continue(),
  );
  await title.fill("Offline retained edit");
  await page.locator(".builder-toolbar h1").click();
  await expect(page.locator(".v2-statusbar [role=status]")).toContainText(
    "Offline",
  );
  page.once("dialog", (d) => d.accept());
  await page.reload();
  await expect(title).toHaveText("Offline retained edit");
  await page.unroute("**/v1/workspace/website");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await saved(page);
  // An edit made while a previous save is in flight is queued, never lost.
  let release: (() => void) | undefined,
    held = false;
  await page.route("**/v1/workspace/website", async (route) => {
    if (route.request().method() === "PUT" && !held) {
      held = true;
      const response = await route.fetch();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ response });
    } else await route.continue();
  });
  await title.fill("First queued edit");
  await expect.poll(() => !!release).toBe(true);
  await title.fill("Latest queued edit");
  release!();
  await page.locator(".builder-toolbar h1").click();
  await saved(page);
  await page.unroute("**/v1/workspace/website");
  expect(
    (await current(page)).document.sections[0].content.find(
      (t: any) => t.locale === "en",
    ).title,
  ).toBe("Latest queued edit");
  // A different session wins on the server; recovery requires a deliberate choice.
  const concurrent = await current(page);
  const competing = structuredClone(concurrent.document);
  competing.sections[0].content.find((t: any) => t.locale === "en").title =
    "Other session edit";
  expect(
    (
      await page.request.put(`${api}/v1/workspace/website`, {
        data: {
          ...concurrent,
          document: competing,
          expectedUpdatedAt: concurrent.updatedAt,
        },
      })
    ).ok(),
  ).toBe(true);
  await title.fill("My conflicting edit");
  await page.locator(".builder-toolbar h1").click();
  await expect(page.locator(".v2-statusbar [role=status]")).toContainText(
    "Another session",
  );
  page.once("dialog", (d) => d.accept());
  await page.reload();
  await expect(title).toHaveText("My conflicting edit");
  await page
    .getByRole("button", { name: "Use saved version", exact: true })
    .click();
  await saved(page);
  await expect(title).toHaveText("Other session edit");
  // Template switch retains confirmed copy; original publication is independent.
  const beforeStyle = await current(page);
  await openTool(page, "Change style");
  await page.getByRole("radio").nth(2).click();
  await page.getByRole("button", { name: /Apply this look/ }).click();
  await saved(page);
  const changed = await current(page);
  expect(changed.document.sections.map(({ layout, ...s }: any) => s)).toEqual(
    beforeStyle.document.sections.map(({ layout, ...s }: any) => s),
  );
  await page.locator(".ws-hero figure[role=button]").click();
  await page
    .getByRole("dialog")
    .getByLabel("Upload photo", { exact: true })
    .setInputFiles({
      name: "synthetic-hero.png",
      mimeType: "image/png",
      buffer: await sharp({
        create: {
          width: 1800,
          height: 1200,
          channels: 3,
          background: "#a76e42",
        },
      })
        .png()
        .toBuffer(),
    });
  await page.getByRole("button", { name: "Save photo", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await saved(page);
  expect(
    (await current(page)).document.sections[0].media[0].assetId,
  ).not.toContain("demo:");
  // Add a product in the same studio, then edit it directly from the website.
  await openTool(page, "Edit / import menu");
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Test espresso");
  await page.getByLabel("Price", { exact: false }).fill("3.20");
  await page
    .getByRole("textbox", { name: "Choose a product category" })
    .fill("Coffee");
  await page.getByLabel("Name", { exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Choose a product category" }),
  ).not.toHaveValue("");
  await page.getByRole("button", { name: "Save product", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Photography", exact: true }),
  ).toBeVisible();
  await page
    .locator(".v2-menu-studio>header")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Menu: Test espresso", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Confirmed espresso");
  await page.getByLabel("Price", { exact: false }).fill("3.50");
  await page.getByRole("button", { name: "Save product", exact: true }).click();
  await expect
    .poll(async () => {
      const menu = await (
        await page.request.get(`${api}/v1/staff/menu`)
      ).json();
      return menu.categories[0]?.products[0]?.priceMinor;
    })
    .toBe(350);
  await page
    .locator(".v2-menu-studio>header")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  // Reviewed mock AI is rendered visually, with no provider metadata in the UI.
  const beforePreview = await current(page);
  await openTool(page, "Change style");
  await expect(
    page
      .locator(".v2-template-options .ws-products h4")
      .filter({ hasText: "Confirmed espresso" }),
  ).toHaveCount(3);
  const stylePhotos = page.locator(".v2-template-options .ws-hero img");
  await expect(stylePhotos).toHaveCount(3);
  await expect
    .poll(async () =>
      stylePhotos.evaluateAll((images) =>
        images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
      ),
    )
    .toBe(true);
  await page
    .locator(".v2-template-picker>header")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  expect((await current(page)).document).toEqual(beforePreview.document);
  await openTool(page, "AI");
  await page
    .getByRole("button", { name: "Create a proposal", exact: true })
    .click();
  await expect(page.locator(".builder-proposal")).toBeVisible();
  await expect(page.locator(".builder-controls")).toHaveCount(0);
  expect(await page.locator(".builder-proposal").textContent()).not.toContain(
    "browser-acceptance",
  );
  await page
    .getByRole("button", { name: "Accept into draft", exact: true })
    .click();
  await saved(page);
  await expect(title).toHaveText("A place for coffee");
  const beforeDesign = await current(page);
  await openTool(page, "AI");
  await page
    .getByLabel("Style only \u00b7 keep content", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Create a proposal", exact: true })
    .click();
  await expect(page.locator(".builder-proposal")).toBeVisible();
  await page
    .getByRole("button", { name: "Accept into draft", exact: true })
    .click();
  await saved(page);
  expect(
    (await current(page)).document.sections.map(({ layout, ...s }: any) => s),
  ).toEqual(beforeDesign.document.sections.map(({ layout, ...s }: any) => s));
  const beforeSection = await current(page);
  await page.locator(".ws-about .ws-select").click();
  await page
    .locator(".builder-section-controls summary")
    .filter({ hasText: /AI/ })
    .click();
  await page.getByRole("button", { name: /Improve/, exact: true }).click();
  await expect(page.locator(".builder-proposal")).toBeVisible();
  await page
    .getByRole("button", { name: "Accept into draft", exact: true })
    .click();
  await saved(page);
  const afterSection = await current(page);
  expect(afterSection.document.sections[0]).toEqual(
    beforeSection.document.sections[0],
  );
  await page
    .locator(".builder-controls>.builder-actions")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect.poll(async () => (await current(page)).status).toBe("PUBLISHED");
  const published = await (
    await page.request.get(
      `${api}/v1/public/websites/${changed.publicSlug}?locale=en`,
    )
  ).json();
  await title.fill("Private correction");
  await page.locator(".builder-toolbar h1").click();
  await saved(page);
  expect(
    (
      await (
        await page.request.get(
          `${api}/v1/public/websites/${changed.publicSlug}?locale=en`,
        )
      ).json()
    ).document,
  ).toEqual(published.document);
  const publicPage = await page.context().newPage();
  await publicPage.goto(`/en/venue/${changed.publicSlug}`);
  await expect(publicPage.locator(".website-sections h1")).toHaveText(
    "A place for coffee",
  );
  await expect(publicPage).toHaveTitle(/Synthetic cafe/);
  await publicPage.close();
  // Import menu while published; review contains no website modifications.
  const designBeforeImport = await current(page),
    w = businessImportCopy("en"),
    c = compactCopy("en");
  await openTool(page, "Edit / import menu");
  await page
    .getByRole("button", { name: "Import PDF / photo / website", exact: true })
    .click();
  await page
    .getByLabel(w.upload, { exact: true })
    .setInputFiles("artifacts/import-v2/text-menu.pdf");
  await page.getByLabel(w.authorize, { exact: true }).check();
  await page.getByRole("button", { name: w.analyze, exact: false }).click();
  await expect(page.locator(".bi-menu-row")).toHaveCount(2);
  await expect(page.locator("#import-identity")).toHaveCount(0);
  await expect(
    page.getByText("Compare with current menu", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: c.selectAll, exact: true }).click();
  await page.getByLabel(c.ack, { exact: true }).check();
  await page.getByRole("button", { name: new RegExp(`^${c.approve}`) }).click();
  await expect(page.locator(".bi-notice")).toHaveText(c.saved);
  await page.getByLabel(w.confirm, { exact: true }).check();
  await page
    .getByRole("button", { name: new RegExp(`^${c.import} 2`) })
    .click();
  await expect(page.locator(".bi-complete")).toBeVisible();
  expect((await current(page)).document).toEqual(designBeforeImport.document);
  expect((await current(page)).updatedAt).toBe(designBeforeImport.updatedAt);
  await page
    .locator(".v2-menu-studio>header")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page.locator(".ws-products article")).toHaveCount(3);
  // Browser-level tenant isolation: another owner cannot change this product.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await login(otherPage, "sq");
  const product = (
    await (await page.request.get(`${api}/v1/staff/menu`)).json()
  ).categories.flatMap((c: any) => c.products)[0];
  expect(
    (
      await otherPage.request.put(
        `${api}/v1/staff/menu/products/${product.id}`,
        { data: product },
      )
    ).status(),
  ).toBe(404);
  await other.close();
  for (const width of [1440, 768, 360]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await page
        .locator(".builder-toolbar button,.v2-statusbar button,.ws-select")
        .evaluateAll((nodes) =>
          nodes
            .filter((n) => {
              const r = n.getBoundingClientRect();
              return (
                r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44)
              );
            })
            .map((n) => n.textContent),
        ),
    ).toEqual([]);
    await expect(page.locator(".builder-preview")).toBeVisible();
    expect(
      await page.locator(".ws-section").evaluateAll((sections) =>
        sections
          .filter((section) => {
            const control = section
              .querySelector(".ws-select")
              ?.getBoundingClientRect();
            const heading = section
              .querySelector(".ws-copy h1,.ws-copy h2")
              ?.getBoundingClientRect();
            return (
              control &&
              heading &&
              control.right > heading.left &&
              control.left < heading.right &&
              control.bottom > heading.top &&
              control.top < heading.bottom
            );
          })
          .map((section) => section.id),
      ),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/import-v2/v2-editor-${width}.png`,
      fullPage: true,
      timeout: 15000,
    });
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.locator(".ws-about .ws-select").click();
  await page.locator(".ws-about .ws-copy p [contenteditable]").focus();
  await page.screenshot({
    path: "artifacts/import-v2/v2-inline-edit.png",
    timeout: 15000,
  });
  await page.goto("/app/en/website/preview");
  await expect(page.locator(".experience-v2")).toBeVisible();
  await page.screenshot({
    path: "artifacts/import-v2/v2-full-preview.png",
    fullPage: true,
    timeout: 15000,
  });
});
for (const locale of ["sq", "de", "it"] as const)
  test(`V2 template without AI in ${locale}`, async ({ page }) => {
    await login(page, locale);
    await page.goto(`/app/${locale}/website`);
    await expect(page.getByRole("radio")).toHaveCount(3);
    await page
      .getByRole("button", { name: new RegExp(websiteV2Copy(locale)[3]!) })
      .click();
    await expect(page.locator(".builder-preview .ws-hero h1")).toContainText(
      `Garden fixture ${locale}`,
    );
    await expect(page.locator(".builder-controls")).toHaveCount(0);
    expect((await current(page)).document.sections).toHaveLength(5);
  });
