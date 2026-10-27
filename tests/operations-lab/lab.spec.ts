import { test, expect } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import type { LocalState } from "../../apps/api/src/operations-lab/provision";
const api = "http://127.0.0.1:4400";
for (const profile of ["DE", "AL"]) {
  test(
    profile + " real authenticated workspace and receipt views",
    async ({ page }) => {
      const state = JSON.parse(
        await readFile(".operations-lab/" + profile + ".json", "utf8"),
      ) as LocalState;
      const actor = state.actors.manager!;
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      // Genuine login UI, credentials are never captured in traces/screenshots.
      await page.goto("/en/staff/login");
      await page.locator('input[name="email"]').fill(actor.email);
      await page.locator('input[name="password"]').fill(actor.password);
      const loginResponse = page.waitForResponse(
        (r) =>
          r.url() === api + "/v1/auth/login" && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page
        .evaluate(() => {
          const input = document.querySelector<HTMLInputElement>(
            'input[name="password"]',
          );
          if (input) input.value = "";
        })
        .catch(() => {});
      const response = await loginResponse;
      // Clear secrets before any failing assertion can create Playwright context.
      await page
        .evaluate(() => {
          const input = document.querySelector<HTMLInputElement>(
            'input[name="password"]',
          );
          if (input) input.value = "";
        })
        .catch(() => {});
      expect(response.status()).toBe(200);
      await page.waitForURL("**/app/en/overview", {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
      await page.goto("/en/staff/orders", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Today", exact: true }).click();
      await expect
        .poll(() => page.locator("main article").count())
        .toBeGreaterThanOrEqual(4);
      await expect(
        page
          .locator("main")
          .getByRole("link", { name: "Receipt", exact: true }),
      ).not.toHaveCount(0);
      await page.screenshot({
        path: "artifacts/operations-lab/" + profile + "-orders.png",
        fullPage: true,
      });
      await page.goto("/en/staff/kitchen", { waitUntil: "domcontentloaded" });
      await expect(page.locator("main")).toBeVisible();
      const reportFiles = (await readdir("artifacts/operations-lab"))
        .filter(
          (f) =>
            f.startsWith(profile + "-") && f.endsWith("-reconciliation.json"),
        )
        .sort();
      const report = JSON.parse(
        await readFile(
          "artifacts/operations-lab/" + reportFiles.at(-1),
          "utf8",
        ),
      );
      expect(report.discrepancies).toEqual([]);
      expect(report.counts).toMatchObject({
        orders: 4,
        tickets: 8,
        payments: 4,
        receipts: 3,
        pdfs: 3,
      });
      // Persistent LAB2 may legitimately reprint these immutable smoke receipts.
      // Every recorded P3 job must finish; financial/source counts stay exact.
      expect(report.counts.printed).toBeGreaterThanOrEqual(6);
      expect(report.counts.printed).toBe(report.counts.printJobs);
      expect(report.counts.failed).toBe(0);
      for (const receipt of report.receipts) {
        await page.goto("/en/staff/receipts/" + receipt.id, {
          waitUntil: "domcontentloaded",
        });
        await expect(
          page.getByRole("heading", {
            name: "Receipt #" + receipt.number,
            exact: true,
          }),
        ).toBeVisible();
        await expect(page.getByTestId("receipt-total")).toBeVisible();
        await expect(page.locator(".receipt-page")).toContainText("TEST ONLY");
      }
      await page.screenshot({
        path: "artifacts/operations-lab/" + profile + "-receipt.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/en/staff/pos", { waitUntil: "domcontentloaded" });
      await expect(page.locator(".pos-page")).toBeVisible();
      await expect(
        page
          .locator(".pos-product")
          .filter({ hasText: "TEST ONLY Pizza Margherita" }),
      ).toHaveCount(1);
      await expect(page.locator(".pos-page")).toContainText(
        "TEST ONLY Pizza Margherita",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: "artifacts/operations-lab/" + profile + "-pos-390.png",
        fullPage: true,
      });
      const status = await page.request.get(api + "/v1/staff/register");
      expect(status.ok()).toBe(true);
      expect((await status.json()).session).toBeNull();
      expect(errors).toEqual([]);
    },
  );
}
test("cross-tenant access and synthetic contact boundaries", async ({
  request,
}) => {
  const de = JSON.parse(
    await readFile(".operations-lab/DE.json", "utf8"),
  ) as LocalState;
  const actor = de.actors.manager!,
    staff = actor.staff!;
  expect(
    (
      await request.post(api + "/v1/auth/login", {
        data: {
          tenantSlug: staff.tenantSlug,
          venueSlug: staff.venueSlug,
          email: actor.email,
          password: actor.password,
        },
      })
    ).ok(),
  ).toBe(true);
  const files = (await readdir("artifacts/operations-lab"))
    .filter((f) => f.startsWith("AL-") && f.endsWith("-reconciliation.json"))
    .sort();
  const al = JSON.parse(
    await readFile("artifacts/operations-lab/" + files.at(-1), "utf8"),
  );
  expect(
    (
      await request.get(api + "/v1/staff/receipts/" + al.receipts[0].id)
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post(api + "/v1/staff/hardware/jobs", {
        data: {
          receiptId: al.receipts[0].id,
          deviceId: "wrong-venue",
          key: "cross-tenant-lab-test",
        },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post(api + "/v1/staff/team/invitations", {
        data: {
          email: "real-contact@example.com",
          role: "WAITER",
          preferredLocale: "en",
        },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post(api + "/v1/public/online-orders/operations-lab-de", {
        data: {
          contact: {
            name: "Real Guest",
            phone: "+49123456789",
            email: "real-contact@example.com",
          },
        },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.put(api + "/v1/workspace/website/domain", {
        data: { hostname: "example.com" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post(api + "/v1/demo/orders/unknown/status", {
        data: { status: "READY" },
      })
    ).status(),
  ).toBe(403);
  // Existing normal station permissions remain authoritative.
  const cook = de.actors.kitchen!;
  await request.post(api + "/v1/auth/login", {
    data: {
      tenantSlug: staff.tenantSlug,
      venueSlug: staff.venueSlug,
      email: cook.email,
      password: cook.password,
    },
  });
  expect((await request.get(api + "/v1/staff/production/BAR")).status()).toBe(
    403,
  );
});
