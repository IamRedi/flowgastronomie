import { test, expect, type Page } from "./browser-fixture";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { businessImportCopy } from "../../apps/web/app/app/[lang]/onboarding/business-import/import-copy";
import { entryCopy } from "../../apps/web/app/app/[lang]/onboarding/business-import/entry-copy";
import { compactCopy } from "../../apps/web/app/app/[lang]/onboarding/business-import/compact-copy";

const api = "http://localhost:4302";
async function owners() {
  return JSON.parse(await readFile("artifacts/import-v2/owners.json", "utf8"));
}
async function login(
  page: Page,
  locale: "sq" | "de" | "en" | "it",
  email: string,
  password: string,
) {
  const d = JSON.parse(
    await readFile(`apps/web/dictionaries/${locale}.json`, "utf8"),
  );
  await page.goto(
    `/${locale}/staff/login?next=${encodeURIComponent(`/app/${locale}/onboarding/business-import`)}`,
  );
  await expect(
    page.locator("input[name=tenantSlug],input[name=venueSlug]"),
  ).toHaveCount(0);
  await page.getByLabel(d.staff.email, { exact: true }).fill(email);
  await page.getByLabel(d.staff.password, { exact: true }).fill(password);
  await page.getByRole("button", { name: d.staff.signIn, exact: true }).click();
  await expect(page).toHaveURL(
    /\/app\/[a-z]+\/onboarding\/business-import(?:\?|$)/,
  );
}
async function approve(page: Page, locale: "sq" | "de" | "en" | "it") {
  const w = businessImportCopy(locale),
    c = compactCopy(locale);
  await page.getByRole("button", { name: c.businessKeep, exact: true }).click();
  await page.getByRole("button", { name: c.selectAll, exact: true }).click();
  await page.getByLabel(c.ack, { exact: true }).check();
  await page.getByRole("button", { name: new RegExp(`^${c.approve}`) }).click();
  await expect(page.locator(".bi-row-state").first()).toHaveText(c.reviewed);
  await expect(page.locator(".bi-notice")).toHaveText(c.saved, {
    timeout: 15000,
  });
  await page.getByLabel(w.confirm, { exact: true }).check();
}
test("public page → email login → real PDF → autosave/refresh → recovered commit → Draft → POS-only activation", async ({
  page,
  browser,
}) => {
  const w = businessImportCopy("en"),
    c = compactCopy("en"),
    email = `${randomUUID()}@import.invalid`,
    password = "Self-service-browser-123!";
  const r = await page.request.post(`${api}/v1/public/trials`, {
    data: {
      requestKey: randomUUID(),
      organizationName: "Synthetic self-service journey",
      venueName: "Fresh PDF venue",
      ownerDisplayName: "Test Owner",
      email,
      password,
      locale: "en",
      countryCode: "DE",
      timezone: "Europe/Berlin",
      currency: "EUR",
      plan: "RESTAURANT_PRO",
      profileId: "PIZZERIA",
      applyCategories: false,
    },
  });
  expect(r.status()).toBe(201);
  await page.request.post(`${api}/v1/auth/logout`);
  await page.goto("/en");
  await expect(page.locator('a[href="/en/staff/login"]').first()).toBeVisible();
  await expect(page.locator('a[href="/en/signup"]').first()).toBeVisible();
  await expect(page.locator('a[href^="mailto:pilot@"]')).toHaveCount(0);
  await login(page, "en", email, password);
  const e = entryCopy("en");
  await expect(page.getByLabel(w.url, { exact: true })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has("import")).toBe(false);
  const old = await (
    await page.request.post(`${api}/v1/staff/business-imports`, {
      data: {
        requestKey: randomUUID(),
        locale: "en",
        url: "https://bistro.example.com",
        authorized: true,
      },
    })
  ).json();
  await page.reload();
  await expect(page.locator(".bi-pending")).toHaveCount(1);
  await page.getByRole("button", { name: e.resume, exact: true }).click();
  await expect(page.locator(".bi-source-bar")).toContainText(
    "bistro.example.com",
  );
  await page.getByRole("button", { name: e.back, exact: true }).click();
  await expect(page.getByLabel(w.url, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: e.remove, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    (
      await (
        await page.request.get(`${api}/v1/staff/business-imports/${old.id}`)
      ).json()
    ).businessData.phase,
  ).toBe("SOURCES");
  await page.getByRole("button", { name: e.confirm, exact: true }).click();
  await expect(page.locator(".bi-pending")).toHaveCount(0);
  await page
    .getByLabel(w.upload, { exact: true })
    .setInputFiles("artifacts/import-v2/text-menu.pdf");
  await page.getByRole("button", { name: e.website, exact: true }).click();
  await expect(page.getByLabel(w.upload, { exact: true })).toHaveValue("");
  await page
    .getByLabel(w.url, { exact: true })
    .fill("https://bistro.example.com");
  await page
    .getByLabel(w.upload, { exact: true })
    .setInputFiles("artifacts/import-v2/text-menu.pdf");
  await expect(page.getByLabel(w.url, { exact: true })).toHaveCount(0);
  await page.getByLabel(w.authorize, { exact: true }).check();
  await page.getByRole("button", { name: w.analyze, exact: false }).click();
  await expect(page.locator(".bi-menu-row")).toHaveCount(2);
  const cancelledId = new URL(page.url()).searchParams.get("import")!;
  await page
    .locator(".bi-menu-row")
    .first()
    .locator("input")
    .nth(1)
    .fill("Discard this cached edit");
  // Cancellation must win over an autosave response that arrives late.
  let releaseSave: (() => void) | undefined;
  await page.route("**/v1/staff/business-imports/*/review", async (route) => {
    const response = await route.fetch();
    await new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    await route.fulfill({ response });
  });
  await expect.poll(() => !!releaseSave).toBe(true);
  let discarded = false;
  await page.route("**/v1/staff/business-imports/*/discard", async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    discarded = true;
    await route.abort("connectionfailed");
  });
  await page.getByRole("button", { name: e.cancel, exact: true }).click();
  await page.getByRole("button", { name: e.confirm, exact: true }).click();
  await expect(page.locator(".bi-entry")).toBeVisible();
  expect(discarded).toBe(true);
  releaseSave!();
  await page.unroute("**/v1/staff/business-imports/*/review");
  await page.unroute("**/v1/staff/business-imports/*/discard");
  await page.reload();
  await expect(page.locator(".bi-menu-row")).toHaveCount(0);
  await expect(page.locator(".bi-pending")).toHaveCount(0);
  expect(
    await page.evaluate(
      (id) => sessionStorage.getItem(`flowgastronomie.import-review.${id}`),
      cancelledId,
    ),
  ).toBeNull();
  await expect(page.getByLabel(w.url, { exact: true })).toHaveCount(0);
  await expect(page.locator(".bi-selected-files")).toHaveCount(0);
  await page.goto(`/app/en/onboarding/business-import?import=${cancelledId}`);
  await expect(page.getByText(e.cancelled, { exact: true })).toBeVisible();
  await expect(page.locator(".bi-menu-row")).toHaveCount(0);
  await page.getByRole("button", { name: e.back, exact: true }).click();
  await page.getByLabel(w.authorize, { exact: true }).check();
  await page
    .getByLabel(w.upload, { exact: true })
    .setInputFiles("artifacts/import-v2/text-menu.pdf");
  await expect(page.getByText("text-menu.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: w.analyze, exact: false }).click();
  await expect(page.locator(".bi-menu-row")).toHaveCount(2);
  const id = new URL(page.url()).searchParams.get("import")!;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let saves = 0;
  await page.route("**/v1/staff/business-imports/*/review", async (route) => {
    if (route.request().postDataJSON().confirm === false && saves++ === 0) {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("connectionfailed");
    } else await route.continue();
  });
  await page
    .locator(".bi-menu-row")
    .first()
    .locator("input")
    .nth(1)
    .fill("Reviewed soup");
  await expect(page.locator(".bi-notice")).toHaveText(c.saved, {
    timeout: 15000,
  });
  await page.reload();
  await expect(
    page.locator(".bi-menu-row").first().locator("input").nth(1),
  ).toHaveValue("Reviewed soup");
  expect(
    (await (await page.request.get(`${api}/v1/staff/menu`)).json()).categories,
  ).toHaveLength(0);
  await page.context().setOffline(true);
  await page
    .locator(".bi-menu-row")
    .first()
    .locator("input")
    .nth(1)
    .fill("Offline reviewed soup");
  await expect(page.locator(".bi-notice")).toHaveText(c.unsaved, {
    timeout: 15000,
  });
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).some((k) =>
        k.startsWith("flowgastronomie.import-review."),
      ),
    ),
  ).toBe(true);
  await page.context().setOffline(false);
  await page.reload();
  await expect(
    page.locator(".bi-menu-row").first().locator("input").nth(1),
  ).toHaveValue("Offline reviewed soup");
  await expect(page.locator(".bi-notice")).toHaveText(c.saved, {
    timeout: 15000,
  });
  await approve(page, "en");
  let commits = 0;
  await page.route("**/v1/staff/business-imports/*/commit", async (route) => {
    commits++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("connectionfailed");
  });
  await page.getByRole("button", { name: /^Import 2 products/ }).click();
  await expect(page.getByRole("heading", { name: w.saved })).toBeVisible();
  expect(commits).toBe(1);
  const replay = await page.request.post(
    `${api}/v1/staff/business-imports/${id}/commit`,
    { data: { expectedVersion: 0, confirm: true } },
  );
  expect((await replay.json()).replayed).toBe(true);
  let menu = await (await page.request.get(`${api}/v1/staff/menu`)).json();
  expect(menu.categories.flatMap((x: any) => x.products)).toHaveLength(2);
  expect(
    menu.categories.every(
      (x: any) =>
        !x.published &&
        x.products.every((p: any) => !p.published && !p.available),
    ),
  ).toBe(true);
  expect(
    (
      await (
        await page.request.get(`${api}/v1/staff/pos/menu?locale=en`)
      ).json()
    ).categories,
  ).toHaveLength(0);
  const activation = page.locator(".pos-activation");
  await activation
    .getByRole("button", { name: c.selectAll, exact: true })
    .click();
  await activation.getByLabel(c.posConfirm, { exact: true }).check();
  await activation
    .getByRole("button", { name: /^Activate selected in POS/ })
    .click();
  await expect(activation).toContainText(c.posDone);
  menu = await (await page.request.get(`${api}/v1/staff/menu`)).json();
  expect(
    menu.categories.every(
      (x: any) =>
        !x.published &&
        x.products.every((p: any) => !p.published && p.posEnabled),
    ),
  ).toBe(true);
  expect(
    (await (await page.request.get(`${api}/v1/workspace/website`)).json())
      .status,
  ).toBe("DRAFT");
  await activation.getByRole("link", { name: c.pos, exact: true }).click();
  await expect(page.locator(".pos-product")).toHaveCount(2);
  const other = await browser.newContext();
  const owner = (await owners())[0];
  await other.request.post(`${api}/v1/auth/login`, {
    data: { email: owner.email, password: owner.password },
  });
  expect(
    (
      await other.request.get(`${api}/v1/staff/business-imports/${id}`)
    ).status(),
  ).toBe(404);
  expect(
    (await (await other.request.get(`${api}/v1/staff/menu`)).json()).categories,
  ).toHaveLength(0);
  await other.close();
  await page.goto(`/app/en/website`);
  await expect(page.locator(".website-builder")).toBeVisible();
  await page.getByRole("button", { name: /Create my website/ }).click();
  await expect(page.locator(".v2-statusbar [role=status]")).toHaveText("Saved");
  const importedSite = await (
    await page.request.get(`${api}/v1/workspace/website`)
  ).json();
  expect(importedSite.document.version).toBe(1);
  expect(importedSite.status).toBe("DRAFT");
  expect(
    (await (await page.request.get(`${api}/v1/staff/menu`)).json()).categories
      .flatMap((c: any) => c.products)
      .every((p: any) => !p.published),
  ).toBe(true);
  expect(errors).toEqual([]);
});
for (const locale of ["sq", "de", "en", "it"] as const)
  test(`${locale}: compact URL review, search, source drawer and touch layout`, async ({
    page,
  }) => {
    const owner = (await owners()).find((o: any) => o.locale === locale),
      w = businessImportCopy(locale),
      c = compactCopy(locale);
    await login(page, locale, owner.email, owner.password);
    await page
      .getByRole("button", { name: entryCopy(locale).website, exact: true })
      .click();
    await page
      .getByLabel(w.url, { exact: true })
      .fill("https://bistro.example.com");
    await page.getByLabel(w.authorize, { exact: true }).check();
    await page.getByRole("button", { name: w.analyze, exact: false }).click();
    await expect(page.locator(".bi-menu-row")).toHaveCount(2);
    expect(await page.locator(".bi-product").count()).toBe(0);
    await page
      .getByRole("button", { name: c.businessApply, exact: true })
      .click();
    await page.getByLabel(c.search, { exact: true }).fill("does not exist");
    await expect(page.locator(".bi-menu-row")).toHaveCount(0);
    await page.getByLabel(c.search, { exact: true }).fill("");
    await page
      .getByRole("button", { name: c.details, exact: true })
      .first()
      .click();
    await expect(page.locator("dialog")).toBeVisible();
    await page
      .locator("dialog")
      .getByRole("button", { name: c.close, exact: true })
      .first()
      .click();
    await expect(page.locator("dialog")).toHaveCount(0);
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `artifacts/import-v2/compact-${locale}-${width}.png`,
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: c.selectAll, exact: true }).click();
    await page.getByLabel(c.ack, { exact: true }).check();
    await page
      .getByRole("button", { name: new RegExp(`^${c.approve}`) })
      .click();
    await page.getByRole("button", { name: new RegExp(`^${c.skip}`) }).click();
    await expect(page.locator(".bi-notice")).toHaveText(c.saved, {
      timeout: 15000,
    });
    await page.reload();
    await expect(page.locator(".bi-menu-row")).toHaveCount(2);
    await expect(page.locator(".bi-row-state").first()).toHaveText(c.reviewed);
    await page.getByLabel(w.confirm, { exact: true }).check();
    await page
      .getByRole("button", { name: new RegExp(`^${c.import} 1`) })
      .click();
    await expect(page.getByRole("heading", { name: w.saved })).toBeVisible();
    await page.getByRole("link", { name: w.manageDraft, exact: false }).click();
    await expect(page.locator(".menu-admin-product")).toHaveCount(1);
    await page.goto(`/app/${locale}/website`);
    await expect(page.locator(".website-builder")).toBeVisible();
  });
