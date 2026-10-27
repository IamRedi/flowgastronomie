import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@flowgastronomie/database";
const api = "http://localhost:4300",
  base = `${api}/v1/staff/setup-media`;
test.afterAll(() => prisma.$disconnect());
async function next(page: Page) {
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}
async function save(page: Page) {
  await next(page);
  await next(page);
  await page
    .getByLabel(
      "I have reviewed these photos, their product assignments and disclosures.",
    )
    .check();
  await page.getByRole("button", { name: "Save photos", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your photos are saved" }),
  ).toBeVisible();
}
for (const kind of ["DEMO", "REAL"]) {
  test(`${kind}: canonical media review, reload, shared consumers and immutable replacement`, async ({
    page,
    browser,
  }) => {
    const manifest = JSON.parse(
      await readFile("artifacts/setup/acceptance.json", "utf8"),
    );
    const tenant = manifest.tenants.find(
      (t: { kind: string }) => t.kind === kind,
    );
    const other = manifest.tenants.find(
      (t: { kind: string }) => t.kind !== kind,
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
    const initial = await (await page.request.get(base)).json();
    const reset = await page.request.post(`${base}/reset`, {
      data: { expectedVersion: initial.progress.version, confirm: true },
    });
    expect(reset.ok()).toBe(true);
    const product = await prisma.product.findFirstOrThrow({
      where: {
        tenantId: tenant.tenantId,
        venueId: tenant.venueId,
        translations: {
          some: { name: { in: ["Margherita", "DEMO Margherita"] } },
        },
      },
      include: { translations: true },
    });
    const productName = product.translations.find(
      (t) => t.locale === "EN",
    )!.name;
    const beforeCount = await prisma.product.count({
      where: { tenantId: tenant.tenantId },
    });
    await page.goto("/app/en/onboarding/media");
    const logo = page.getByRole("article", { name: "Logo", exact: true });
    await expect(logo).toBeVisible();
    const replaceLogo = logo.getByLabel("Replace Logo", { exact: true });
    if (await replaceLogo.count())
      await replaceLogo.setInputFiles("artifacts/setup/media-logo.png");
    else
      await logo
        .getByLabel("Upload photo Logo", { exact: true })
        .setInputFiles("artifacts/setup/media-logo.png");
    await expect(logo.locator("img")).toBeVisible();
    await expect(page.locator(".setup-media")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await next(page);
    const card = page.getByRole("article", { name: productName, exact: true });
    await card.getByText("Source & permissions", { exact: true }).click();
    if (kind !== "DEMO")
      await card
        .getByLabel("Photo source", { exact: true })
        .selectOption("DEMO");
    await card
      .getByLabel(`Upload photo ${productName}`, { exact: true })
      .setInputFiles("artifacts/setup/media-margherita.webp");
    await expect(page.locator(".setup-media")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    const makePrimary = card.getByRole("button", {
      name: "Make primary",
      exact: true,
    });
    if (await makePrimary.count()) await makePrimary.last().click();
    await expect(card.getByText("Primary", { exact: true })).toBeVisible();
    await expect(page.locator(".setup-media")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    for (const file of [
      "media-margherita-alternate.png",
      "controlled-menu.png",
    ]) {
      await Promise.all([
        page.waitForResponse(
          (r) => r.url() === base && r.request().method() === "PUT",
        ),
        card
          .getByLabel(`Upload photo ${productName}`, { exact: true })
          .setInputFiles(`artifacts/setup/${file}`),
      ]);
    }
    const draftBefore = await (await page.request.get(base)).json();
    const gallery = draftBefore.assignments.filter(
      (r: { productId: string; role: string }) =>
        r.productId === product.id && r.role === "GALLERY",
    );
    expect(gallery).toHaveLength(2);
    const lastGallery = card
      .locator("figure")
      .filter({ has: page.locator(`img[src*="${gallery[1].assetId}"]`) });
    await Promise.all([
      page.waitForResponse(
        (r) => r.url() === base && r.request().method() === "PUT",
      ),
      lastGallery
        .getByRole("button", { name: "Move earlier", exact: true })
        .click(),
    ]);
    const reordered = await (await page.request.get(base)).json();
    expect(
      reordered.assignments.find(
        (r: { assetId: string }) => r.assetId === gallery[1].assetId,
      ).sortOrder,
    ).toBe(0);
    await Promise.all([
      page.waitForResponse(
        (r) => r.url() === base && r.request().method() === "PUT",
      ),
      lastGallery.getByRole("button", { name: "Remove", exact: true }).click(),
    ]);
    await expect(lastGallery).toHaveCount(0);
    await page.reload();
    await expect(card.getByText("Primary", { exact: true })).toBeVisible();
    await page.screenshot({
      path: `artifacts/setup/${kind.toLowerCase()}-media-products.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/setup/${kind.toLowerCase()}-media-mobile.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await save(page);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Your photos are saved" }),
    ).toBeVisible();
    const media = await (
      await page.request.get(`${api}/v1/workspace/media`)
    ).json();
    const primary = media.products.find(
      (r: { productId: string }) => r.productId === product.id,
    ).media;
    const logoAsset = media.venue.find(
      (r: { role: string }) => r.role === "LOGO",
    ).media;
    expect(primary.source).toBe("DEMO");
    const original = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: primary.id },
    });
    const originalHash = createHash("sha256")
      .update(original.bytes)
      .digest("hex");
    await page.goto("/en/staff/pos");
    if (product.published)
      await expect(
        page.locator(`img[src*="/v1/media/${primary.id}"]`).first(),
      ).toBeVisible();
    else
      await expect(
        page.locator(`img[src*="/v1/media/${primary.id}"]`),
      ).toHaveCount(0);
    await page.screenshot({
      path: `artifacts/setup/${kind.toLowerCase()}-media-pos.png`,
      fullPage: true,
    });
    await page.goto("/app/en/website/preview");
    if (product.published)
      await expect(
        page.locator(`img[src*="/v1/media/${primary.id}"]`).first(),
      ).toBeVisible();
    else
      await expect(
        page.locator(`img[src*="/v1/media/${primary.id}"]`),
      ).toHaveCount(0);
    await expect(
      page.locator(`img[src*="/v1/media/${logoAsset.id}"]`).first(),
    ).toBeVisible();
    await page.screenshot({
      path: `artifacts/setup/${kind.toLowerCase()}-media-website.png`,
      fullPage: true,
    });
    const source = await page.request.get(
      `${api}/v1/staff/creative/sources?locale=en`,
    );
    expect(source.ok()).toBe(true);
    const catalog = await source.json();
    expect(
      catalog.media.products.find(
        (r: { productId: string }) => r.productId === product.id,
      ).media.id,
    ).toBe(primary.id);
    expect(
      catalog.media.venue.find((r: { role: string }) => r.role === "LOGO").media
        .id,
    ).toBe(logoAsset.id);
    await page.goto("/app/en/onboarding/media");
    await page
      .getByRole("button", { name: "Edit photos", exact: true })
      .click();
    await next(page);
    await card.getByText("Source & permissions", { exact: true }).click();
    if (kind !== "DEMO")
      await card
        .getByLabel("Photo source", { exact: true })
        .selectOption("DEMO");
    await card
      .getByLabel(`Replace ${productName}`, { exact: true })
      .first()
      .setInputFiles("artifacts/setup/media-margherita-alternate.png");
    await expect(page.locator(".setup-media")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await save(page);
    const current = await prisma.productMedia.findFirstOrThrow({
      where: {
        tenantId: tenant.tenantId,
        venueId: tenant.venueId,
        productId: product.id,
        role: "PRIMARY",
      },
    });
    expect(current.mediaAssetId).not.toBe(original.id);
    const old = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(createHash("sha256").update(old.bytes).digest("hex")).toBe(
      originalHash,
    );
    expect(
      await prisma.product.count({ where: { tenantId: tenant.tenantId } }),
    ).toBe(beforeCount);
    const foreign = await browser.newContext();
    try {
      expect(
        (
          await foreign.request.post(`${api}/v1/auth/login`, {
            data: {
              tenantSlug: other.tenantSlug,
              venueSlug: other.venueSlug,
              email: other.email,
              password: other.password,
            },
          })
        ).ok(),
      ).toBe(true);
      expect(
        (
          await foreign.request.get(`${api}/v1/media/${current.mediaAssetId}`)
        ).status(),
      ).toBe(404);
      const state = await (await foreign.request.get(base)).json();
      const assign = await foreign.request.put(base, {
        data: {
          expectedVersion: state.progress.version,
          step: 1,
          assignments: [
            {
              assetId: current.mediaAssetId,
              productId: null,
              role: "LOGO",
              sortOrder: 0,
            },
          ],
        },
      });
      expect(assign.status()).toBe(404);
    } finally {
      await foreign.close();
    }
  });
}
