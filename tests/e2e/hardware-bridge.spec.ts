import { expect, type Page } from "@playwright/test";
import { test } from "./authenticated-test";
const api = "http://localhost:4100/v1/staff/hardware";
async function setup(page: Page) {
  await page.goto("/app/en/overview");
  await expect(page).toHaveURL(/\/app\/en\/overview$/);
  await page.goto("/en/staff/pos");
  await expect(page.locator(".pos-product").first()).toBeVisible();
  const register = page.getByRole("region", { name: "Register", exact: true });
  await expect(register).toHaveAttribute("aria-busy", "false");
  await register
    .getByRole("button", { name: /Register|No open register/, exact: true })
    .click();
  const start = register.getByRole("button", { name: "Start shift" });
  if (await start.isVisible()) await start.click();
  if (await register.getByLabel("Counted cash").isVisible()) {
    await register.getByLabel("Counted cash").fill("0.00");
    await register.getByRole("button", { name: "Close register" }).click();
    await expect(register.getByLabel("Opening cash")).toBeVisible();
  }
  await register.getByLabel("Opening cash").fill("1.00");
  await register
    .getByRole("button", { name: "Open register", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Register", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Hardware settings", exact: true })
    .click();
  const settings = page.getByRole("region", { name: "Hardware settings" });
  await settings.getByRole("button", { name: "Pair simulator" }).click();
  await expect(settings).toContainText("SIMULATOR");
  await settings.getByLabel("Auto-print receipt", { exact: true }).check();
  await expect(
    settings.getByLabel("Auto-print receipt", { exact: true }),
  ).toBeChecked();
  await settings
    .getByLabel("Auto-open drawer after CASH", { exact: true })
    .check();
  await expect(
    settings.getByLabel("Auto-open drawer after CASH", { exact: true }),
  ).toBeChecked();
  const body = await (await page.request.get(`${api}/devices`)).json();
  return { deviceId: body.devices[0].id as string, settings, register };
}
async function order(page: Page) {
  const hardware = page.getByRole("dialog", {
    name: "Hardware settings",
    exact: true,
  });
  if (await hardware.isVisible()) await page.keyboard.press("Escape");
  await page
    .locator(".pos-product")
    .filter({ hasText: "Seasonal burrata" })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await page.locator(".pos-submit").click();
  await expect(page.getByText("Order sent to the kitchen")).toBeVisible();
}
async function cash(page: Page) {
  await order(page);
  await page.getByLabel("Amount received").fill("20.00");
  await page.getByRole("button", { name: "Confirm cash payment" }).click();
  await expect(
    page.getByRole("heading", { name: /Receipt #R-/ }),
  ).toBeVisible();
}
async function diagnostics(page: Page, id: string) {
  const response = await page.request.post(
    `${api}/simulator/${id}/diagnostics`,
    { data: { nextPrintFailure: null } },
  );
  expect(response.ok()).toBe(true);
  return response.json();
}
test("CASH triggers simulated drawer then printing; reprint keeps the same finalized receipt", async ({
  page,
}) => {
  const { deviceId, settings } = await setup(page);
  const before = await diagnostics(page, deviceId);
  await cash(page);
  await expect(page.getByTestId("print-job-status")).toContainText("PRINTED");
  const receiptHeading = await page
    .getByRole("heading", { name: /Receipt #R-/ })
    .innerText();
  const trace = await diagnostics(page, deviceId);
  const actions = trace.operations
    .slice(before.operations.length)
    .map((o: { action: string }) => o.action);
  expect(actions).toEqual(["drawer", "print", "feed", "cut"]);
  const receiptId = trace.commands.at(-1).receiptId;
  await page
    .getByRole("button", { name: "Reprint receipt", exact: true })
    .click();
  await expect(page.getByTestId("print-job-status")).toContainText("PRINTED");
  await expect(page.getByRole("heading", { name: /Receipt #R-/ })).toHaveText(
    receiptHeading,
  );
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`${api}/receipts/${receiptId}/jobs`)
          ).json()
        ).length,
    )
    .toBe(2);
  const jobs = await (
    await page.request.get(`${api}/receipts/${receiptId}/jobs`)
  ).json();
  expect(jobs).toHaveLength(2);
  expect(
    jobs.every((j: { receiptId: string }) => j.receiptId === receiptId),
  ).toBe(true);
  await page.getByRole("button", { name: "New order", exact: true }).click();
  await expect(page.locator(".pos-cart-lines li")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Hardware settings", exact: true })
    .click();
  await settings.getByLabel("Auto-print receipt", { exact: true }).uncheck();
  await settings
    .getByLabel("Auto-open drawer after CASH", { exact: true })
    .uncheck();
});
test("paper failure retains CASH payment; retry prints; CARD never opens drawer", async ({
  page,
}) => {
  const { deviceId, settings } = await setup(page);
  await settings
    .getByRole("button", { name: "Test printer", exact: true })
    .click();
  await expect(settings).toContainText("Done");
  await settings.getByRole("button", { name: "Simulate paper out" }).click();
  await expect(settings).toContainText("Done");
  await cash(page);
  await expect(page.getByTestId("print-job-status")).toContainText("FAILED");
  await expect(
    page.getByRole("region", { name: "Receipt printing" }).getByRole("alert"),
  ).toContainText("Payment recorded. Receipt not printed.");
  const trace = await diagnostics(page, deviceId);
  const receiptId = trace.commands.at(-1).receiptId;
  const receiptBefore = await (
    await page.request.get(
      `http://localhost:4100/v1/staff/receipts/${receiptId}`,
    )
  ).json();
  expect(receiptBefore.status).toBe("FINALIZED");
  expect(receiptBefore.method).toBe("CASH");
  await page.getByRole("button", { name: "Retry print", exact: true }).click();
  await expect(page.getByTestId("print-job-status")).toContainText("PRINTED");
  await expect(page.getByTestId("print-job-status")).toContainText(
    "Attempts: 2",
  );
  expect(
    await (
      await page.request.get(
        `http://localhost:4100/v1/staff/receipts/${receiptId}`,
      )
    ).json(),
  ).toEqual(receiptBefore);
  const afterCash = await diagnostics(page, deviceId);
  const drawers = afterCash.operations.filter(
    (o: { action: string }) => o.action === "drawer",
  ).length;
  await page.getByRole("button", { name: "New order", exact: true }).click();
  await order(page);
  await page.getByRole("button", { name: "Card", exact: true }).click();
  await page
    .getByLabel(
      "Confirm only after the independent card terminal accepts payment.",
    )
    .check();
  await page.getByRole("button", { name: "Confirm card payment" }).click();
  await expect(page.getByTestId("print-job-status")).toContainText("PRINTED");
  const afterCard = await diagnostics(page, deviceId);
  expect(
    afterCard.operations.filter(
      (o: { action: string }) => o.action === "drawer",
    ).length,
  ).toBe(drawers);
  await page.getByRole("button", { name: "New order", exact: true }).click();
  await expect(page.locator(".pos-cart-lines li")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Hardware settings", exact: true })
    .click();
  await settings.getByLabel("Auto-print receipt", { exact: true }).uncheck();
  await settings
    .getByLabel("Auto-open drawer after CASH", { exact: true })
    .uncheck();
});
