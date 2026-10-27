import { expect, type Page } from "./browser-test";
import { test } from "./authenticated-test";
import { reconciliationText } from "../../apps/web/lib/order-reconciliation-copy";
import type {
  DailyOperationsReport,
  DailyReconciliation,
  SimplePilotOrder,
} from "@flowgastronomie/domain";

const reconciliation: DailyReconciliation = {
  ordersCreated: {
    count: 2,
    orderValueMinor: 2870,
    paidMinor: 1650,
    pendingMinor: 1220,
    unallocatedMinor: 0,
    overpaidMinor: 0,
    excludedCount: 0,
  },
  paymentsRecorded: {
    totalMinor: 4750,
    cashMinor: 1650,
    cardMinor: 3100,
    otherMinor: 0,
    todayOrdersMinor: 1650,
    otherPaymentsMinor: 3100,
    earlierOrdersMinor: 3100,
    tableSessionOnlyMinor: 0,
    excludedOrdersMinor: 0,
    unlinkedMinor: 0,
  },
};
const fixtureOrder = (
  id: string,
  overrides: Partial<SimplePilotOrder>,
): SimplePilotOrder => ({
  id,
  reference: id,
  source: "COUNTER",
  lifecycleStatus: "ACCEPTED",
  productionStatus: "NEW",
  paymentStatus: "PENDING_PAYMENT",
  totalMinor: 1220,
  currency: "EUR",
  createdAt: "2026-10-05T10:00:00.000Z",
  receiptId: null,
  paidMinor: 0,
  paymentMethods: [],
  sessionPaymentMinor: 0,
  canPay: false,
  items: [],
  tickets: [],
  canManage: false,
  canProduce: false,
  canComplete: false,
  ...overrides,
});
const paid = fixtureOrder("PAIDTEST", {
  lifecycleStatus: "SERVED",
  productionStatus: "COMPLETED",
  paymentStatus: "PAID",
  totalMinor: 1650,
  paidMinor: 1650,
  paymentMethods: ["CASH"],
  receiptId: "fixture-receipt",
});
const pending = fixtureOrder("WAITTEST", {});

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
for (const locale of ["en", "sq", "de", "it"] as const) {
  for (const width of [1366, 390]) {
    test(`${locale} reconciliation, historical filters and live separation at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
      const text = reconciliationText(locale);
      // Node and Chromium can ship different ICU locale data (notably sq).
      // Compare against the formatter used by the actual browser UI.
      const amounts = await page.evaluate((lang) => {
        const formatter = new Intl.NumberFormat(lang, {
          style: "currency",
          currency: "EUR",
        });
        return Object.fromEntries(
          [2870, 1650, 1220, 4750, 3100].map((n) => [
            n,
            formatter.format(n / 100),
          ]),
        );
      }, locale);
      const money = (n: number) => amounts[n]!;
      const baseReport = (await (
        await page.request.get("http://localhost:4100/v1/staff/reports/daily")
      ).json()) as DailyOperationsReport;
      const mutations: string[] = [];
      const errors: string[] = [];
      const filterRequests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (
          request.url().includes("/v1/") &&
          !["GET", "OPTIONS"].includes(request.method())
        )
          mutations.push(request.url());
      });
      // Read-only browser fixtures verify presentation. The PostgreSQL suite
      // independently asserts these exact values from persisted relationships.
      await page.route("**/v1/staff/reports/daily*", (route) =>
        route.fulfill({
          json: {
            ...baseReport,
            date: "2026-10-05",
            scope: "VENUE",
            reconciliation,
            orders: {
              submitted: 2,
              served: 1,
              cancelled: 0,
              orderValueMinor: 2870,
            },
            payments: {
              recordedMinor: 4750,
              cashMinor: 1650,
              cardMinor: 3100,
              otherMinor: 0,
              voidedMinor: 0,
            },
            channels: {
              table: { submitted: 2, orderValueMinor: 2870 },
              pickup: { submitted: 0, orderValueMinor: 0 },
              delivery: { submitted: 0, orderValueMinor: 0 },
              catering: { submitted: 0, orderValueMinor: 0 },
            },
          },
        }),
      );
      await page.route("**/v1/staff/pilot/orders*", (route) => {
        const query = new URL(route.request().url()).searchParams;
        const view = query.get("view") ?? "ACTIVE";
        filterRequests.push(`${view}:${query.get("date") ?? "default"}`);
        return route.fulfill({
          json:
            view === "ACTIVE"
              ? [pending]
              : view === "TODAY"
                ? [paid, pending]
                : [paid],
        });
      });
      await page.goto(`/app/${locale}/overview`);
      await expect(page.getByTestId("daily-orders")).toHaveText("2");
      await expect(page.getByTestId("daily-order-value")).toHaveText(
        money(2870),
      );
      await expect(page.getByTestId("daily-paid-orders")).toHaveText(
        money(1650),
      );
      await expect(page.getByTestId("daily-pending-orders")).toHaveText(
        money(1220),
      );
      await expect(page.getByTestId("daily-payments")).toHaveText(money(4750));
      await expect(
        page.getByTestId("active-orders").locator("strong"),
      ).toHaveText("1");
      await expect(
        page.getByRole("heading", { name: text.live, exact: true }),
      ).toBeVisible();
      const explanation = page.locator(".desk-reconciliation-details summary");
      await explanation.click();
      await expect(page.locator(".desk-reconciliation-details")).toContainText(
        text.explanation,
      );
      await expect(page.locator(".desk-reconciliation-details")).toContainText(
        money(3100),
      );
      await expect(
        page.getByRole("link", { name: text.fullReport }),
      ).toHaveAttribute("href", `/${locale}/staff/reports#reconciliation`);
      await explanation.click();
      await noOverflow(page);
      if (width !== 390) {
        const dimensions = await page.evaluate(() => ({
          viewport: innerHeight,
          document: document.documentElement.scrollHeight,
          body: document.body.scrollHeight,
          mainTop: document.querySelector(".desk-main")?.getBoundingClientRect()
            .top,
          mainHeight: document
            .querySelector(".desk-main")
            ?.getBoundingClientRect().height,
          detailsOpen: document
            .querySelector(".desk-reconciliation-details")
            ?.hasAttribute("open"),
        }));
        expect(
          dimensions.document,
          JSON.stringify(dimensions),
        ).toBeLessThanOrEqual(dimensions.viewport);
      }
      await page.screenshot({
        path: `artifacts/reconciliation/dashboard-${locale}-${width}.png`,
        fullPage: true,
      });
      await page.goto(`/${locale}/staff/reports`);
      for (const [id, value] of [
        ["order-value", 2870],
        ["paid", 1650],
        ["pending", 1220],
        ["other", 3100],
        ["recorded", 4750],
      ] as const)
        await expect(page.getByTestId(`reconciliation-${id}`)).toHaveText(
          money(value),
        );
      await expect(page.locator("#reconciliation")).toContainText(
        text.earlierOrders,
      );
      const methods = page.locator(".report-panel").filter({
        has: page.getByRole("heading", {
          name: text.recordedToday,
          exact: true,
        }),
      });
      await expect(methods.getByText(text.card, { exact: true })).toBeVisible();
      await expect(methods).toContainText(money(3100));
      await noOverflow(page);
      await page.screenshot({
        path: `artifacts/reconciliation/report-${locale}-${width}.png`,
        fullPage: true,
      });
      await page.goto(`/${locale}/staff/orders`);
      const filters = page.getByRole("navigation", { name: text.filters });
      await expect(
        filters.getByRole("button", { name: text.views.ACTIVE, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("[data-order-reference]")).toHaveCount(1);
      await expect(
        page.locator('[data-order-reference="WAITTEST"]'),
      ).toContainText(money(1220));
      await filters
        .getByRole("button", { name: text.views.TODAY, exact: true })
        .click();
      await expect(page.locator("[data-order-reference]")).toHaveCount(2);
      await page.getByLabel(text.date).fill("2026-10-05");
      await expect
        .poll(() => filterRequests.includes("TODAY:2026-10-05"))
        .toBe(true);
      const paidRow = page.locator('[data-order-reference="PAIDTEST"]');
      await expect(paidRow).toContainText(text.states.SERVED);
      await expect(paidRow).toContainText(text.states.COMPLETED);
      await expect(paidRow).toContainText(text.linkedPaid);
      await expect(paidRow).toContainText(text.total);
      await expect(paidRow).toContainText(text.methods.CASH);
      await expect(paidRow).toContainText(money(1650));
      await expect(
        paidRow.getByRole("link", { name: text.receipt, exact: true }),
      ).toHaveAttribute("href", `/${locale}/staff/receipts/fixture-receipt`);
      await paidRow.getByRole("button").click();
      await expect(page.getByRole("dialog")).toContainText(text.states.SERVED);
      await expect(page.getByRole("dialog").locator("input")).toHaveCount(0);
      await expect(
        page.getByRole("dialog").locator(".counter-payment"),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(paidRow.getByRole("button")).toBeFocused();
      await noOverflow(page);
      const targets = await page
        .locator(
          ".order-view-filters button, .order-view-context input, .order-receipt-link",
        )
        .evaluateAll((els) =>
          els.map((el) => {
            const box = el.getBoundingClientRect();
            return box.width >= 44 && box.height >= 44;
          }),
        );
      expect(targets.every(Boolean)).toBe(true);
      await page.screenshot({
        path: `artifacts/reconciliation/orders-${locale}-${width}.png`,
        fullPage: true,
      });
      for (const view of ["PAID", "COMPLETED"] as const) {
        await filters
          .getByRole("button", { name: text.views[view], exact: true })
          .click();
        await expect(page.locator("[data-order-reference]")).toHaveCount(1);
        await expect(paidRow).toBeVisible();
      }
      await filters
        .getByRole("button", { name: text.views.ACTIVE, exact: true })
        .click();
      await expect(paidRow).toHaveCount(0);
      expect(mutations).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

test("unallocated session value is explained separately from pending", async ({
  page,
}) => {
  const baseReport = await (
    await page.request.get("http://localhost:4100/v1/staff/reports/daily")
  ).json();
  await page.route("**/v1/staff/reports/daily*", (route) =>
    route.fulfill({
      json: {
        ...baseReport,
        reconciliation: {
          ordersCreated: {
            count: 1,
            orderValueMinor: 1000,
            paidMinor: 0,
            pendingMinor: 0,
            unallocatedMinor: 1000,
            overpaidMinor: 0,
            excludedCount: 0,
          },
          paymentsRecorded: {
            ...reconciliation.paymentsRecorded,
            totalMinor: 1000,
            cashMinor: 1000,
            cardMinor: 0,
            todayOrdersMinor: 0,
            otherPaymentsMinor: 1000,
            earlierOrdersMinor: 0,
            tableSessionOnlyMinor: 1000,
          },
        },
      },
    }),
  );
  await page.goto("/en/staff/reports");
  await expect(page.getByTestId("reconciliation-pending")).toHaveText("€0.00");
  await expect(page.getByTestId("reconciliation-unallocated")).toHaveText(
    "€10.00",
  );
  await expect(page.locator("#reconciliation")).toContainText(
    reconciliationText("en").sessionNote,
  );
});
