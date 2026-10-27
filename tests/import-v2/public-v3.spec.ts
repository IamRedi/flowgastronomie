import { test, expect, type Page } from "./browser-fixture";
import sharp from "sharp";
import { websiteTemplate } from "@flowgastronomie/domain";
import {
  mockOrdering,
  orderingToken,
  trackingFixture,
} from "../helpers/online-ordering-fixture";
const api = "http://localhost:4302";
const locales = ["en", "sq", "de", "it"] as const;
const names = (name: string) => locales.map((locale) => ({ locale, name }));
async function call(
  page: Page,
  method: "get" | "post" | "put" | "patch",
  path: string,
  data?: unknown,
) {
  const response = await page.request[method](
    api + path,
    data === undefined ? {} : { data },
  );
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(
    true,
  );
  return response.status() === 204 ? null : response.json();
}
async function fixture(page: Page, locale: "en" | "sq") {
  await call(page, "post", "/v1/auth/login", {
    email: `public-${locale}@import-v2.example`,
    password: "import-v2-acceptance-password",
  });
  const category = await call(page, "post", "/v1/staff/menu/categories", {
    published: true,
    sortOrder: 0,
    translations: names(locale === "en" ? "Coffee & pastries" : "Pizza"),
  });
  const product = await call(page, "post", "/v1/staff/menu/products", {
    categoryId: category.id,
    priceMinor: 850,
    sortOrder: 0,
    published: true,
    available: true,
    station: "KITCHEN",
    translations: names(locale === "en" ? "Warm pastry" : "Margherita"),
  });
  const bar = await call(page, "post", "/v1/staff/menu/products", {
    categoryId: category.id,
    priceMinor: 350,
    sortOrder: 1,
    published: true,
    available: true,
    station: "BAR",
    translations: names("Espresso"),
  });
  await call(
    page,
    "put",
    `/v1/staff/menu/products/${product.id}/configuration`,
    {
      variants: [
        {
          priceDeltaMinor: 200,
          sortOrder: 0,
          available: true,
          isDefault: true,
          translations: names("Large"),
        },
      ],
      modifierGroups: [
        {
          minSelect: 1,
          maxSelect: 1,
          sortOrder: 0,
          translations: names("Extra"),
          options: [
            {
              priceDeltaMinor: 150,
              sortOrder: 0,
              available: true,
              translations: names("Basil"),
            },
          ],
        },
      ],
    },
  );
  const photo = await sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: locale === "en" ? "#c59f76" : "#af6249",
    },
  })
    .webp()
    .toBuffer();
  const upload = await page.request.put(
    `${api}/v1/workspace/products/${product.id}/media?approved=true`,
    { headers: { "content-type": "image/webp" }, data: photo },
  );
  expect(upload.ok()).toBe(true);
  const media = await upload.json();
  await call(page, "put", "/v1/staff/online-order-settings", {
    pickupEnabled: true,
    deliveryEnabled: locale === "sq",
    cateringEnabled: true,
    pickupLeadMinutes: 1,
  });
  await call(page, "post", "/v1/staff/shift/start", {});
  let website = await call(page, "get", "/v1/workspace/website");
  website.translations = locales.map((locale) => ({
    locale,
    heroTitle: website.venueName,
    heroSubtitle: "A synthetic venue for ordering acceptance.",
    storyTitle: "Our kitchen",
    storyBody: "Synthetic acceptance content.",
    seoTitle: website.venueName,
    seoDescription: "Synthetic ordering acceptance.",
  }));
  const template = websiteTemplate({
    profileId: locale === "en" ? "CAFE" : "PIZZERIA",
    styleId: locale === "en" ? "cafe-1" : "pizzeria-2",
    venueName: website.venueName,
    translations: website.translations,
  });
  website = await call(page, "put", "/v1/workspace/website", {
    ...website,
    document: template.document,
    designVersion: 2,
    premiumStyleId: template.style.id,
    address: "Synthetic test address 1",
    phone: "+49 30 123456",
    openingHours: [
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "SUNDAY",
    ].map((day) => ({
      day,
      closed: false,
      opensAt: "00:00",
      closesAt: "23:59",
    })),
  });
  await call(page, "post", "/v1/workspace/website/publish", {
    expectedUpdatedAt: website.updatedAt,
  });
  return { website, category, product, bar, media };
}
async function addConfigured(page: Page, name: string) {
  await page.getByRole("button", { name: `Add: ${name}`, exact: true }).click();
  const options = page.getByRole("dialog", { name, exact: true });
  await options.getByLabel(/Basil/).check();
  await options
    .getByRole("button", { name: "Add to basket", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Your basket", exact: true }),
  ).toBeVisible();
}
async function review(page: Page) {
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Synthetic guest");
  await page.getByLabel("Phone", { exact: true }).fill("+49 30 123456");
  await page.getByRole("button", { name: "Review order", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Confirm order", exact: true }),
  ).toBeVisible();
}

test("V3 integrated website, canonical updates, drawer, exact retry and real Kitchen/Bar SSE", async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  const f = await fixture(page, "en"),
    slug = f.website.publicSlug;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/en/venue/${slug}`);
  await expect(page.locator(".public-experience")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".public-gallery img")).toHaveCount(1);
  await expect(page.locator(".public-products img").first()).toHaveAttribute(
    "src",
    new RegExp(f.media.id),
  );
  await expect(
    page.getByRole("link", { name: /Open in Maps/ }),
  ).toHaveAttribute("href", /maps\/search/);
  await addConfigured(page, "Warm pastry");
  await expect(page.locator(".online-cart-item")).toContainText("12.00");
  const drawer = page.getByRole("dialog", { name: "Your basket", exact: true });
  expect((await drawer.boundingBox())!.x).toBeGreaterThan(500);
  await drawer.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await addConfigured(page, "Warm pastry");
  await page.keyboard.press("Escape");
  const restoredRefresh = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url() === `${api}/v1/public/websites/${slug}?locale=en`,
    { timeout: 15000 },
  );
  await page.reload();
  await (await restoredRefresh).finished();
  await page.getByRole("button", { name: "Basket (1)", exact: true }).click();
  await expect(page.locator(".online-cart-item")).toContainText("Large");
  await page.keyboard.press("Escape");
  const menu = await call(page, "get", "/v1/staff/menu");
  const product = menu.categories
    .flatMap((c: any) => c.products)
    .find((p: any) => p.id === f.product.id);
  await call(page, "put", `/v1/staff/menu/products/${product.id}`, {
    ...product,
    priceMinor: 950,
  });
  const priceRefresh = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url() === `${api}/v1/public/websites/${slug}?locale=en`,
    { timeout: 15000 },
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await (await priceRefresh).finished();
  await page.getByRole("button", { name: "Basket (1)", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Confirm updated basket" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm updated basket" }).click();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Add: Espresso", exact: true })
    .click();
  await review(page);
  await expect(page.locator(".public-checkout-review")).toContainText("16.50");
  let lost = false;
  const bodies: string[] = [];
  await page.route(`**/v1/public/online-orders/${slug}`, async (route) => {
    bodies.push(route.request().postData()!);
    if (!lost) {
      lost = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("connectionfailed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Confirm order", exact: true })
    .dblclick();
  await expect(
    page.getByRole("button", { name: "Retry order", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Basket (2)", exact: true }).click();
  await page.getByRole("button", { name: "Retry order", exact: true }).click();
  await expect(page).toHaveURL(/\/order\/track\/recovered\?venue=/);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  const orders = await call(page, "get", "/v1/staff/online-orders");
  expect(orders).toHaveLength(1);
  const reference = orders[0].referenceCode;
  await call(page, "patch", `/v1/staff/online-orders/${reference}/status`, {
    status: "ACCEPTED",
  });
  await expect(page.locator(".tracking-status")).toHaveAttribute(
    "data-state",
    "ACCEPTED",
  );
  for (const station of ["KITCHEN", "BAR"]) {
    const tickets = await call(
      page,
      "get",
      `/v1/staff/online-production/${station}`,
    );
    const ticket = tickets.find((t: any) => t.referenceCode === reference);
    expect(ticket).toBeTruthy();
    await call(
      page,
      "patch",
      `/v1/staff/online-production-tickets/${ticket.id}/status`,
      { status: "PREPARING", expectedVersion: ticket.version },
    );
    const latest = (
      await call(page, "get", `/v1/staff/online-production/${station}`)
    ).find((t: any) => t.id === ticket.id);
    await call(
      page,
      "patch",
      `/v1/staff/online-production-tickets/${ticket.id}/status`,
      { status: "READY", expectedVersion: latest.version },
    );
  }
  await expect(page.locator(".tracking-status")).toHaveAttribute(
    "data-state",
    "READY",
  );
  await call(page, "post", `/v1/staff/online-orders/${reference}/messages`, {
    body: "Your synthetic order is ready.",
  });
  await expect(page.locator(".tracking-latest")).toContainText(
    "synthetic order is ready",
  );
  await page.screenshot({
    path: "artifacts/v3-local-tracking.png",
    fullPage: true,
  });
  // A new client cannot read staff data, and a second tenant cannot read this order.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await call(otherPage, "post", "/v1/auth/login", {
    email: "public-de@import-v2.example",
    password: "import-v2-acceptance-password",
  });
  expect(await call(otherPage, "get", "/v1/staff/online-orders")).toEqual([]);
  await call(otherPage, "post", "/v1/staff/shift/start", {});
  expect(
    (
      await otherPage.request.patch(
        `${api}/v1/staff/online-orders/${reference}/status`,
        { data: { status: "CANCELLED" } },
      )
    ).status(),
  ).toBe(404);
  await other.close();
  // Content edits remain Draft. Catalog changes above used explicit menu publication.
  const before = await call(
    page,
    "get",
    `/v1/public/websites/${slug}?locale=en`,
  );
  const draft = await call(page, "get", "/v1/workspace/website");
  await call(page, "put", "/v1/workspace/website", {
    ...draft,
    document: {
      ...draft.document,
      sections: draft.document.sections.map((s: any) =>
        s.type === "HERO"
          ? {
              ...s,
              content: s.content.map((c: any) => ({
                ...c,
                title: "Unpublished draft",
              })),
            }
          : s,
      ),
    },
  });
  expect(
    (await call(page, "get", `/v1/public/websites/${slug}?locale=en`)).document,
  ).toEqual(before.document);
  expect(errors).toEqual([]);
});

test("V3 responsive four-language catalog, options, mobile empty dismissal and publication boundaries", async ({
  page,
}) => {
  const f = await fixture(page, "sq");
  for (const locale of locales)
    for (const width of [1440, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}/venue/${f.website.publicSlug}`);
      await expect(page.locator(".public-products article")).toHaveCount(2);
      expect(
        await page
          .locator(".ws-header")
          .evaluate((el) => el.getBoundingClientRect().height),
      ).toBeLessThan(180);
      expect(
        await page
          .locator(".ws-header nav a")
          .evaluateAll((links) =>
            links.every(
              (link) =>
                link.getBoundingClientRect().height <= 48 &&
                link.getBoundingClientRect().width + 1 >= link.scrollWidth,
            ),
          ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      expect(
        await page
          .locator(".public-add")
          .first()
          .evaluate((el) => el.getBoundingClientRect().height),
      ).toBeGreaterThanOrEqual(44);
    }
  await page.goto(`/en/venue/${f.website.publicSlug}`);
  await page
    .getByRole("button", { name: "Add: Espresso", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Your basket", exact: true });
  const rect = (await dialog.boundingBox())!;
  expect(rect.x).toBe(0);
  expect(rect.y + rect.height).toBeGreaterThanOrEqual(899);
  await page.screenshot({ path: "artifacts/v3-local-bottom-sheet.png" });
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".public-basket-bar")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("button", { name: "Add: Espresso", exact: true })
    .click();
  await expect(dialog).toHaveCSS("animation-name", "none");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Add: Espresso", exact: true }),
  ).toBeFocused();
  await call(page, "post", "/v1/staff/delivery-zones", {
    name: "Synthetic zone",
    postalPrefixes: ["10"],
    feeMinor: 250,
    minimumOrderMinor: 300,
  });
  // Bookmarked order route retains the basket and renders the same site.
  await page.goto(`/en/order/${f.website.publicSlug}`);
  await expect(page.locator(".public-experience")).toBeVisible();
  await page.getByRole("button", { name: "Basket (1)", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("combobox").selectOption("DELIVERY");
  await page
    .getByLabel("Name", { exact: true })
    .fill("Synthetic delivery guest");
  await page.getByLabel("Phone", { exact: true }).fill("+49 30 123456");
  await page.getByLabel("Address", { exact: true }).fill("Synthetic street 1");
  await page.getByLabel("Postcode", { exact: true }).fill("99999");
  await page.getByLabel("City", { exact: true }).fill("Synthetic city");
  await page
    .getByRole("button", { name: "Choose a time", exact: true })
    .click();
  await page.locator(".pickup-slots button").first().click();
  await page.getByRole("button", { name: "Review order", exact: true }).click();
  await expect(
    page.locator(".public-basket-drawer [role=alert]"),
  ).toContainText("Delivery is not available");
  await page.getByLabel("Postcode", { exact: true }).fill("10115");
  await page.getByRole("button", { name: "Review order", exact: true }).click();
  await expect(page.locator(".public-checkout-review")).toContainText("6.00");
  await page
    .getByRole("button", { name: "Confirm order", exact: true })
    .click();
  await expect(page).toHaveURL(/\/order\/track\//);
  const order = (await call(page, "get", "/v1/staff/online-orders"))[0];
  await call(
    page,
    "patch",
    `/v1/staff/online-orders/${order.referenceCode}/status`,
    { status: "ACCEPTED" },
  );
  const ticket = (
    await call(page, "get", "/v1/staff/online-production/BAR")
  )[0];
  await call(
    page,
    "patch",
    `/v1/staff/online-production-tickets/${ticket.id}/status`,
    { status: "PREPARING", expectedVersion: ticket.version },
  );
  await call(
    page,
    "patch",
    `/v1/staff/online-production-tickets/${ticket.id}/status`,
    { status: "READY", expectedVersion: ticket.version + 1 },
  );
  await expect(page.locator(".tracking-status")).toHaveAttribute(
    "data-state",
    "READY",
  );
  await call(
    page,
    "patch",
    `/v1/staff/online-orders/${order.referenceCode}/status`,
    { status: "OUT_FOR_DELIVERY" },
  );
  await expect(
    page.locator('.tracking-progress [aria-current="step"]'),
  ).toContainText("Out for delivery");
  await call(
    page,
    "patch",
    `/v1/staff/online-orders/${order.referenceCode}/status`,
    { status: "COMPLETED" },
  );
  await expect(page.locator(".tracking-status")).toHaveAttribute(
    "data-state",
    "COMPLETED",
  );
  const initialRefresh = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url() ===
        `${api}/v1/public/websites/${f.website.publicSlug}?locale=en`,
  );
  await page.goto(`/en/venue/${f.website.publicSlug}`);
  await (await initialRefresh).finished();
  const menu = await call(page, "get", "/v1/staff/menu");
  await call(page, "put", `/v1/staff/menu/categories/${f.category.id}`, {
    ...menu.categories[0],
    published: false,
  });
  const unpublishedRefresh = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url() ===
        `${api}/v1/public/websites/${f.website.publicSlug}?locale=en`,
    { timeout: 15000 },
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  expect((await (await unpublishedRefresh).json()).menu).toHaveLength(0);
  await expect(page.locator(".public-products article")).toHaveCount(0);
});

test("V3 private SSE states and polling fallback retain real status semantics", async ({
  page,
}) => {
  const state = await mockOrdering(page, true);
  await page.goto(
    `/en/order/track/${orderingToken}?venue=restaurant-olive-demo`,
  );
  await expect(page.locator(".tracking-status")).toHaveAttribute(
    "data-state",
    "PENDING_CONFIRMATION",
  );
  state.status = "READY";
  await expect(page.locator(".tracking-status")).toHaveAttribute(
    "data-state",
    "READY",
    { timeout: 12000 },
  );
  for (const fulfillmentType of ["PICKUP", "DELIVERY"]) {
    for (const status of [
      "PENDING_CONFIRMATION",
      "ACCEPTED",
      "PREPARING",
      "READY",
      ...(fulfillmentType === "DELIVERY" ? ["OUT_FOR_DELIVERY"] : []),
      "COMPLETED",
      "REJECTED",
      "CANCELLED",
    ]) {
      await page.evaluate(
        (order) =>
          window.__orderingStreams.forEach((stream) =>
            stream.dispatchEvent(
              new MessageEvent("order", { data: JSON.stringify(order) }),
            ),
          ),
        { ...trackingFixture(status), fulfillmentType },
      );
      await expect(page.locator(".tracking-status")).toHaveAttribute(
        "data-state",
        status,
      );
      if (status === "OUT_FOR_DELIVERY")
        await expect(
          page.locator('.tracking-progress [aria-current="step"]'),
        ).toContainText("Out for delivery");
      if (status === "REJECTED" || status === "CANCELLED")
        await expect(page.locator(".tracking-progress")).toHaveCount(0);
    }
  }
});
