import { expect, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import sharp from "sharp";
import { productPhotoCopy } from "../../apps/web/components/product-photo-copy";
import { oversizedUploadStatus } from "./oversized-upload-probe.mjs";

export async function productPhotoJourney(
  browser: Browser,
  page: Page,
  api: string,
  web: string,
  prefix: string,
) {
  const c = productPhotoCopy("sq");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const account = {
    email: `${randomUUID()}@product-photo.invalid`,
    password: `Synthetic-${randomUUID()}!`,
  };
  async function checked(
    response: Awaited<ReturnType<typeof page.request.get>>,
  ) {
    expect(
      response.ok(),
      `${response.status()} ${new URL(response.url()).pathname}`,
    ).toBeTruthy();
    return response.json();
  }
  async function register(target: typeof page.request, suffix: string) {
    return checked(
      await target.post(`${api}/v1/public/trials`, {
        data: {
          requestKey: randomUUID(),
          organizationName: "Synthetic photo acceptance",
          venueName: `Atelier Pizza ${suffix}`,
          ownerDisplayName: "Synthetic Test Owner",
          email: suffix
            ? `${randomUUID()}@product-photo.invalid`
            : account.email,
          password: account.password,
          locale: "sq",
          countryCode: "DE",
          timezone: "Europe/Berlin",
          currency: "EUR",
          plan: "RESTAURANT_PRO",
          profileId: "PIZZERIA",
          applyCategories: false,
        },
      }),
    );
  }
  await register(page.request, "");
  await checked(
    await page.request.post(`${api}/v1/auth/login`, { data: account }),
  );
  const items = [
    ["Pizza", "Margherita", 850],
    ["Pasta", "Tagliatelle al pomodoro", 1050],
    ["Sallatë", "Insalata mediterranea", 790],
    ["Dessert", "Tiramisù", 590],
    ["Pije", "Limonata", 350],
    ["Kafe", "Espresso", 250],
    ["Speciale", "Menu del giorno", 1450],
  ] as const;
  const products: { id: string; name: string }[] = [];
  const translations = (name: string) =>
    ["sq", "de", "en", "it"].map((locale) => ({ locale, name }));
  for (const [index, [category, name, priceMinor]] of items.entries()) {
    const cat = await checked(
      await page.request.post(`${api}/v1/staff/menu/categories`, {
        data: {
          sortOrder: index,
          published: false,
          translations: translations(category),
        },
      }),
    );
    const product = await checked(
      await page.request.post(`${api}/v1/staff/menu/products`, {
        data: {
          categoryId: cat.id,
          priceMinor,
          sortOrder: 0,
          available: true,
          published: false,
          station: "KITCHEN",
          translations: translations(name),
        },
      }),
    );
    products.push({ id: product.id, name });
  }
  const before = await checked(await page.request.get(`${api}/v1/staff/menu`));
  // Existing licensed sample photo, used only in this private synthetic tenant.
  const image = await sharp(
    "packages/database/assets/showcases/products/pizza-1.webp",
  )
    .resize(1800, 1200)
    .png()
    .toBuffer();
  await page.goto(`${web}/sq/staff/menu`);
  await expect(page.locator(".menu-product-photo")).toHaveCount(7);
  for (const kind of [
    "pizza",
    "pasta",
    "salad",
    "dessert",
    "drink",
    "coffee",
    "plate",
  ])
    await expect(page.locator(`[data-illustration=${kind}]`)).toHaveCount(1);
  // The canonical API independently enforces its 5 MB limit, even without the UI.
  const boundedImage = await sharp(image).resize(1200, 900).png().toBuffer();
  expect(boundedImage.length).toBeGreaterThan(1024 * 1024);
  expect(boundedImage.length).toBeLessThan(5 * 1024 * 1024);
  const rawUpload = await checked(
    await page.request.put(
      `${api}/v1/workspace/products/${products[0]!.id}/media?approved=true`,
      { headers: { "Content-Type": "image/png" }, data: boundedImage },
    ),
  );
  expect(rawUpload.source).toBe("UPLOAD");
  // Observe the real early 413 without writing a body after rejection.
  // Transport errors remain failures; valid under-limit upload is tested above.
  const cookies = (await page.context().cookies(api))
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  const oversizedStatus = await oversizedUploadStatus(
    `${api}/v1/workspace/products/${products[0]!.id}/media?approved=true`,
    cookies,
  );
  expect(oversizedStatus).toBe(413);
  const open = async () => {
    await page
      .getByRole("button", { name: `${c.photo}: Margherita`, exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
  };
  await open();
  await page.getByRole("button", { name: c.ai, exact: true }).click();
  await expect(page.getByRole("status")).toContainText(c.aiOff);
  await expect(
    page.locator(".photo-ai").getByRole("button", { name: c.ai, exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel(c.prompt)).toHaveValue("Margherita · Pizza");
  await page.getByLabel(c.prompt).fill("Pizza Margherita, soft natural light");
  await page.getByRole("button", { name: c.upload, exact: true }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "dish.png", mimeType: "image/png", buffer: image });
  await expect(page.locator(".photo-preview img")).toBeVisible();
  await page.getByRole("button", { name: c.fit, exact: true }).click();
  await expect(
    page.getByRole("button", { name: c.save, exact: true }),
  ).toBeEnabled();
  // A lost success response must be recoverable with the same content identity.
  let firstId = "";
  await page.route(
    "**/v1/workspace/products/*/media?approved=true",
    async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      firstId = (await response.json()).id;
      await route.abort("connectionfailed");
    },
  );
  await page.getByRole("button", { name: c.save, exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    c.error,
  );
  await page.unroute("**/v1/workspace/products/*/media?approved=true");
  await page.getByRole("button", { name: c.save, exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const media = await checked(
    await page.request.get(`${api}/v1/workspace/media`),
  );
  expect(media.products).toHaveLength(1);
  expect(media.products[0].media.id).toBe(firstId);
  expect(media.products[0].media.width).toBeLessThanOrEqual(1200);
  expect(media.products[0].media.source).toBe("UPLOAD");
  await expect(page.locator(".menu-product-photo img")).toHaveCount(1);
  await expect(page.locator(".menu-product-photo img")).toHaveJSProperty(
    "naturalWidth",
    1200,
  );
  // Browser simulation uses a real MediaStream/canvas track; production camera code stays unchanged.
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#38634b";
        ctx.fillRect(0, 0, 640, 480);
        const stream = canvas.captureStream(10);
        (window as unknown as { photoStream: MediaStream }).photoStream =
          stream;
        return stream;
      },
    });
  });
  await open();
  await page.getByRole("button", { name: c.camera, exact: true }).click();
  await expect(page.locator("video")).toBeVisible();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth),
    )
    .toBe(640);
  await page.getByRole("button", { name: c.capture, exact: true }).click();
  await expect(page.locator(".photo-preview img")).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as unknown as { photoStream: MediaStream }).photoStream
        .getTracks()
        .every((t) => t.readyState === "ended"),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: c.save, exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const replaced = await checked(
    await page.request.get(`${api}/v1/workspace/media`),
  );
  expect(replaced.products[0].media.id).not.toBe(firstId);
  await open();
  await page.evaluate(() =>
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        throw new DOMException("Denied", "NotAllowedError");
      },
    }),
  );
  await page.getByRole("button", { name: c.camera, exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    c.cameraFallback,
  );
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.png",
    mimeType: "image/png",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    c.invalid,
  );
  await expect(
    page.getByRole("button", { name: c.save, exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: c.close, exact: true }).click();
  expect(await checked(await page.request.get(`${api}/v1/staff/menu`))).toEqual(
    before,
  );
  await open();
  await page.locator("input[type=file]").setInputFiles({
    name: "sample.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(page.locator(".photo-preview img")).toBeVisible();
  await page.getByRole("button", { name: c.fit, exact: true }).click();
  await expect(
    page.getByRole("button", { name: c.save, exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: c.save, exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".menu-product-photo img")).toHaveCount(1);
  await page.getByRole("searchbox").fill("Tiramisù");
  await expect(page.locator(".menu-admin-product")).toHaveCount(1);
  await page.getByRole("searchbox").fill("");
  for (const width of [1440, 768, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `${prefix}-menu-${width}.png`,
      fullPage: true,
    });
  }
  const other = await browser.newContext();
  if (new URL(api).hostname === "localhost") {
    await checked(
      await other.request.post(`${api}/v1/auth/login`, {
        data: {
          email: "en@import-v2.example",
          password: "import-v2-acceptance-password",
        },
      }),
    );
  } else await register(other.request, "isolation");
  expect((await other.request.get(`${api}/v1/media/${firstId}`)).status()).toBe(
    404,
  );
  const cross = await other.request.put(
    `${api}/v1/workspace/products/${products[0]!.id}/media?approved=true`,
    { headers: { "Content-Type": "image/png" }, data: boundedImage },
  );
  expect(cross.status()).toBe(400);
  expect(
    (await checked(await other.request.get(`${api}/v1/workspace/media`)))
      .products,
  ).toHaveLength(0);
  await other.close();
  const ids = products.map((p) => p.id);
  await checked(
    await page.request.post(`${api}/v1/staff/menu/pos-activation`, {
      data: { productIds: ids, enabled: true, confirm: true },
    }),
  );
  try {
    await page.goto(`${web}/sq/staff/pos`);
    await expect(page.locator(".pos-product")).toHaveCount(7);
    await expect(page.locator(".pos-product img")).toHaveCount(1);
    await expect
      .poll(() =>
        page
          .locator(".pos-product img")
          .evaluate((im: HTMLImageElement) => im.naturalWidth),
      )
      .toBeGreaterThan(0);
    const pos = await checked(
      await page.request.get(`${api}/v1/staff/pos/menu?locale=sq`),
    );
    expect(
      pos.categories
        .flatMap((x: any) => x.products)
        .find((x: any) => x.id === ids[0]).media.id,
    ).toBe(firstId);
    for (const width of [1440, 768, 360]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `${prefix}-pos-${width}.png`,
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .locator(".pos-product")
      .filter({ hasText: "Margherita" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Shto", exact: true })
      .click();
    await expect(page.locator(".pos-cart-lines li")).toHaveCount(1);
    const basket = await page.locator(".pos-cart-lines").innerText();
    await checked(
      await page.request.put(
        `${api}/v1/workspace/products/${products[0]!.id}/media?approved=true`,
        { headers: { "Content-Type": "image/png" }, data: boundedImage },
      ),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator(".pos-product img")).toHaveAttribute(
      "src",
      `${api}${rawUpload.url}`,
    );
    await expect(page.locator(".pos-cart-lines")).toHaveText(basket, {
      useInnerText: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await checked(
      await page.request.post(`${api}/v1/staff/menu/pos-activation`, {
        data: { productIds: ids, enabled: false, confirm: true },
      }),
    );
    await page.request.post(`${api}/v1/auth/logout`);
  }
  fs.writeFileSync(
    `${prefix}-proof.json`,
    JSON.stringify(
      {
        upload: true,
        cameraSimulation: true,
        cameraDeniedFallback: true,
        invalidFileRejected: true,
        aiDisabled: true,
        sevenIllustrations: true,
        retrySameAsset: true,
        tenantIsolation: true,
        menuUnchangedByPhoto: true,
        sharedPosMedia: true,
        focusRefreshPreservesBasket: true,
        serverSizeLimits: true,
        widths: [1440, 768, 360],
        errors,
        syntheticPosRetired: true,
      },
      null,
      2,
    ),
  );
}
