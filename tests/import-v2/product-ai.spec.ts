import { test, expect } from "./browser-fixture";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { productPhotoCopy } from "../../apps/web/components/product-photo-copy";

test("product AI: explicit generation, lost response, refresh and approval", async ({
  page,
}) => {
  const api = "http://localhost:4302",
    web = "http://localhost:3502",
    c = productPhotoCopy("sq");
  const login = await page.request.post(`${api}/v1/auth/login`, {
    data: {
      email: "photo-sq@import-v2.example",
      password: "import-v2-acceptance-password",
    },
  });
  expect(login.ok()).toBe(true);
  const translations = ["sq", "de", "en", "it"].map((locale) => ({
    locale,
    name: "Pizza Margherita",
  }));
  const category = await (
    await page.request.post(`${api}/v1/staff/menu/categories`, {
      data: { sortOrder: 0, published: false, translations },
    })
  ).json();
  const product = await (
    await page.request.post(`${api}/v1/staff/menu/products`, {
      data: {
        categoryId: category.id,
        priceMinor: 850,
        sortOrder: 0,
        available: true,
        published: false,
        station: "KITCHEN",
        translations,
      },
    })
  ).json();
  let calls = 0,
    approvals = 0;
  const jobs: object[] = [];
  expect(category.id).toBeTruthy();
  expect(product.id).toBeTruthy();
  await page.route(
    `**/v1/staff/creative/products/${product.id}/images`,
    async (route) => {
      if (route.request().method() === "POST") {
        expect(route.request().postDataJSON().provider).toBe("openai");
        calls++;
        jobs.push({
          id: "job",
          state: "SUCCEEDED",
          resultId: "generated-fixture",
          requestKey: randomUUID(),
          createdAt: new Date().toISOString(),
        });
        await route.abort("connectionfailed");
      } else
        await route.fulfill({
          json: {
            enabled: true,
            providers: [{ id: "openai", enabled: true, used: 0, limit: 30 }],
            hasCurrentPhoto: false,
            jobs,
          },
        });
    },
  );
  await page.route(
    "**/v1/staff/creative/assets/generated-fixture/content",
    (route) =>
      route.fulfill({
        contentType: "image/webp",
        body: fs.readFileSync(
          "packages/database/assets/showcases/products/pizza-1.webp",
        ),
      }),
  );
  await page.route(
    `**/v1/staff/creative/products/${product.id}/images/approve`,
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        assetId: "generated-fixture",
        approved: true,
      });
      approvals++;
      await route.fulfill({
        json: {
          id: "canonical-fixture",
          url: "/v1/media/canonical-fixture",
          source: "GENERATED",
          label: "AI-generated illustration",
          width: 1024,
          height: 1024,
          contentHash: "a".repeat(64),
          approvedForPublicUse: true,
        },
      });
    },
  );
  async function open() {
    await page
      .getByRole("button", {
        name: `${c.photo}: Pizza Margherita`,
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: c.ai, exact: true }).click();
  }
  await page.goto(`${web}/sq/staff/menu`);
  await open();
  await expect(page.getByLabel(c.prompt)).toHaveValue(/Pizza Margherita/);
  await page
    .locator(".photo-ai")
    .getByRole("button", { name: c.ai, exact: true })
    .click();
  await expect(page.locator(".photo-ai img")).toBeVisible({ timeout: 12000 });
  expect(calls).toBe(1);
  expect(approvals).toBe(0);
  const frame = await page.locator(".photo-ai .photo-preview").boundingBox();
  const image = await page.locator(".photo-ai img").boundingBox();
  expect(image!.height).toBeLessThanOrEqual(frame!.height + 1);
  await page.reload();
  await open();
  await expect(page.locator(".photo-ai img")).toBeVisible();
  expect(calls).toBe(1);
  await page.getByRole("button", { name: c.approveImage, exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(approvals).toBe(1);
});
