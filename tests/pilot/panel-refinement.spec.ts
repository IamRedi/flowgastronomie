import { test, expect, type Page } from "@playwright/test";

const api = "http://localhost:4000";
const nav = (page: Page) =>
  page.getByRole("navigation", { name: "Operations" });
const shell = (page: Page) => page.locator(".pilot-app-shell");
async function login(page: Page) {
  await page.goto("/en/staff/login");
  await page.locator('input[name="tenantSlug"]').fill("flowgastronomie-demo");
  await page.locator('input[name="venueSlug"]').fill("restaurant-olive");
  await page.locator('input[name="password"]').fill("Demo1234!");
  await page
    .locator('input[name="email"]')
    .fill("manager@flowgastronomie.local");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".desk-information")).toBeVisible();
}
async function shot(page: Page, name: string) {
  await page.screenshot({
    path: `artifacts/panel-refinement/${name}.png`,
    style: "nextjs-portal{display:none!important}",
  });
}
async function sidebarFits(page: Page) {
  expect(
    await page.locator(".app-sidebar").evaluate((el) => ({
      x: el.scrollWidth <= el.clientWidth,
      y: el.scrollHeight <= el.clientHeight,
    })),
  ).toEqual({ x: true, y: true });
  const profile = await page.locator(".app-user").boundingBox();
  expect(profile!.y + profile!.height).toBeLessThanOrEqual(768);
}
test("route defaults, manual sidebar stability, POS scroll regions and language", async ({
  page,
}) => {
  await login(page);
  for (const width of [1366, 1024]) {
    await page.setViewportSize({ width, height: 768 });
    await nav(page).getByRole("link", { name: "Orders", exact: true }).click();
    await nav(page).getByRole("link", { name: "Home", exact: true }).click();
    await expect(shell(page)).toHaveClass(/is-expanded/);
    await expect(
      page.getByTestId("active-orders").locator("strong"),
    ).not.toHaveText("—");
    await sidebarFits(page);
    await shot(page, `home-expanded-${width}`);
    await nav(page).getByRole("link", { name: "Counter", exact: true }).click();
    await expect(shell(page)).toHaveClass(/is-collapsed/);
    await expect(page.locator(".pos-product").first()).toBeVisible();
    await sidebarFits(page);
    await shot(page, `pos-collapsed-${width}`);
    await page.locator(".app-sidebar-toggle").click();
    await expect(shell(page)).toHaveClass(/is-expanded/);
    const product = page
      .locator(".pos-product")
      .filter({ hasText: /Margherita/ });
    await product.click();
    const modal = page.getByRole("dialog", { name: "Margherita", exact: true });
    await modal.getByRole("button", { name: /40 cm/ }).click();
    await modal.getByLabel("Kitchen note (optional)").fill("Panel preview");
    await modal.getByRole("button", { name: "Add", exact: true }).click();
    await expect(shell(page)).toHaveClass(/is-expanded/);
    await expect(product).toBeFocused();
    const search = page.getByRole("button", {
      name: "Search products",
      exact: true,
    });
    await search.click();
    await page.getByRole("searchbox").fill("Margherita");
    await page.getByRole("searchbox").press("Escape");
    await expect(search).toBeFocused();
    await expect(shell(page)).toHaveClass(/is-expanded/);
    // Multiple distinct notes create enough lines to exercise cart scrolling.
    for (let index = 0; index < 4; index++) {
      await product.click();
      await modal
        .getByLabel("Kitchen note (optional)")
        .fill(`Preview ${index}`);
      await modal.getByRole("button", { name: "Add", exact: true }).click();
    }
    await expect(page.locator(".pos-cart-lines li")).toHaveCount(5);
    await sidebarFits(page);
    expect(
      await page
        .locator(".pos-catalog-scroll")
        .evaluate((el) => el.scrollHeight > el.clientHeight),
    ).toBe(true);
    expect(
      await page
        .locator(".pos-cart-lines")
        .evaluate((el) => el.scrollHeight > el.clientHeight),
    ).toBe(true);
    expect(
      await page.evaluate(() => ({
        x: document.documentElement.scrollWidth <= innerWidth,
        y: document.documentElement.scrollHeight <= innerHeight,
      })),
    ).toEqual({ x: true, y: true });
    const submit = await page.locator(".pos-submit").boundingBox();
    expect(submit!.y + submit!.height).toBeLessThanOrEqual(768);
    await shot(page, `pos-expanded-${width}`);
    await page.locator(".app-language").click();
    await page
      .locator("#desk-language-menu")
      .getByRole("link", { name: "Shqip" })
      .click();
    await expect(page).toHaveURL(/\/sq\/staff\/pos$/);
    await expect(shell(page)).toHaveClass(/is-expanded/);
    await expect(
      page.getByRole("button", { name: "Me vete", exact: true }),
    ).toBeVisible();
    await page.locator(".app-language").click();
    await page
      .locator("#desk-language-menu")
      .getByRole("link", { name: "English" })
      .click();
    for (const name of ["Orders", "Kitchen"]) {
      await nav(page).getByRole("link", { name, exact: true }).click();
      await expect(shell(page)).toHaveClass(/is-collapsed/);
    }
  }
});

test("Dashboard daily projection, explicit empty/error states and mobile", async ({
  page,
}) => {
  await login(page);
  const report = await (
    await page.request.get(`${api}/v1/staff/reports/daily`)
  ).json();
  // Controlled read-only fixtures: no database records are changed.
  let populated = true;
  await page.route("**/v1/staff/reports/daily", (route) =>
    route.fulfill({
      json: {
        ...report,
        orders: { ...report.orders, submitted: populated ? 8 : 0 },
        channels: {
          ...report.channels,
          pickup: { submitted: populated ? 3 : 0, orderValueMinor: 0 },
          delivery: { submitted: 0, orderValueMinor: 0 },
          catering: { submitted: 0, orderValueMinor: 0 },
        },
        payments: {
          recordedMinor: populated ? 12500 : 0,
          cashMinor: populated ? 8000 : 0,
          cardMinor: populated ? 4500 : 0,
          otherMinor: 0,
          voidedMinor: 0,
        },
        reconciliation: {
          ordersCreated: {
            count: populated ? 11 : 0,
            orderValueMinor: populated ? 20000 : 0,
            paidMinor: populated ? 12500 : 0,
            pendingMinor: populated ? 7500 : 0,
            unallocatedMinor: 0,
            overpaidMinor: 0,
            excludedCount: 0,
          },
          paymentsRecorded: {
            totalMinor: populated ? 12500 : 0,
            cashMinor: populated ? 8000 : 0,
            cardMinor: populated ? 4500 : 0,
            otherMinor: 0,
            todayOrdersMinor: populated ? 12500 : 0,
            otherPaymentsMinor: 0,
            earlierOrdersMinor: 0,
            tableSessionOnlyMinor: 0,
            excludedOrdersMinor: 0,
            unlinkedMinor: 0,
          },
        },
      },
    }),
  );
  await page.route("**/v1/staff/pilot/orders", (route) =>
    route.fulfill({
      json: populated
        ? [
            {
              id: "fixture-pending",
              source: "WEBSITE",
              lifecycleStatus: "PENDING_CONFIRMATION",
              productionStatus: "NEW",
              paymentStatus: "PENDING_PAYMENT",
              canComplete: false,
            },
            {
              id: "fixture-ready",
              source: "COUNTER",
              lifecycleStatus: "ACCEPTED",
              productionStatus: "READY",
              paymentStatus: "PAID",
              canComplete: true,
            },
          ]
        : [],
    }),
  );
  for (const width of [1366, 1024]) {
    await page.setViewportSize({ width, height: 768 });
    for (const data of [true, false]) {
      populated = data;
      await page.reload();
      await expect(page.getByTestId("daily-orders")).toHaveText(
        data ? "11" : "0",
      );
      await expect(page.getByTestId("daily-payments")).toHaveText(
        data ? "€125.00" : "€0.00",
      );
      await expect(page.locator(".desk-shortcuts")).toHaveCount(0);
      if (!data)
        await expect(page.getByText("No orders need attention.")).toBeVisible();
      await sidebarFits(page);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight,
        ),
      ).toBe(true);
      await shot(
        page,
        `dashboard-${data ? "fixture-data" : "fixture-empty"}-${width}`,
      );
    }
  }
  await page.route("**/v1/staff/reports/daily", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.reload();
  await expect(page.getByText(/Daily report unavailable/)).toBeVisible();
  await expect(page.getByTestId("daily-payments")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Expand navigation", exact: true })
    .click();
  await nav(page).getByRole("link", { name: "Counter", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Navigation", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".pos-product").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await shot(page, "mobile-390");
});
