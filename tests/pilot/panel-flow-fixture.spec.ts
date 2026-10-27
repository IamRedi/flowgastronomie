import { test, expect } from "@playwright/test";

// Browser/UI contract smoke only. All operational writes are intercepted and
// unknown writes fail closed; no order, payment or hardware command reaches DB.
for (const method of ["CASH", "CARD_AT_COUNTER"] as const) {
  test(`isolated UI fixture: configuration → kitchen → ${method} → receipt`, async ({
    page,
  }) => {
    await page.goto("/en/staff/login");
    await page.locator('input[name="tenantSlug"]').fill("flowgastronomie-demo");
    await page.locator('input[name="venueSlug"]').fill("restaurant-olive");
    await page.locator('input[name="password"]').fill("Demo1234!");
    await page
      .locator('input[name="email"]')
      .fill("manager@flowgastronomie.local");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/overview$/);
    const item = {
      productName: "Margherita",
      variantName: "40 cm",
      quantity: 1,
      notes: "UI fixture only",
      modifiers: [],
    };
    let created = false;
    let status = "NEW";
    let paid = false;
    const id = "panel-fixture-12345678";
    const receipt = {
      id: "panel-fixture-receipt",
      number: "UI-FIXTURE",
      orderId: id,
      paymentId: "fixture-payment",
      status: "FINALIZED",
      issuedAt: new Date().toISOString(),
      finalizedAt: new Date().toISOString(),
      currency: "EUR",
      method,
      grossMinor: 1400,
      netMinor: 1308,
      taxMinor: 92,
      receivedMinor: method === "CASH" ? 2000 : null,
      changeMinor: method === "CASH" ? 600 : null,
      business: {
        legalName: "Isolated UI fixture",
        addressLine1: "Test address",
        postalCode: "00000",
        city: "Test",
        countryCode: "DE",
        venueName: "Test",
        vatId: null,
        venueId: "demo-venue",
      },
      cashier: { membershipId: "fixture", displayName: "UI fixture" },
      items: [{ ...item, grossMinor: 1400 }],
      breakdown: [],
    };
    await page.route("**/v1/staff/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const requestMethod = route.request().method();
      if (path === "/v1/staff/shift")
        return route.fulfill({ json: { shift: { id: "fixture-shift" } } });
      if (path === "/v1/staff/register")
        return route.fulfill({
          json: {
            session: { id: "fixture-register", expectedCashMinor: 0 },
            history: [],
          },
        });
      if (path === "/v1/staff/hardware/devices")
        return route.fulfill({ json: { devices: [] } });
      if (path === "/v1/staff/orders" && requestMethod === "POST") {
        const payload = route.request().postDataJSON();
        expect(payload.orderType).toBe("TAKEAWAY");
        expect(payload.items[0]).toMatchObject({
          productId: "pilot-product-pizza-1",
          quantity: 1,
          notes: item.notes,
        });
        expect(payload.items[0].variantId).toBeTruthy();
        created = true;
        return route.fulfill({
          json: { id, totalMinor: 1400, currency: "EUR", tableLabel: null },
        });
      }
      if (path === "/v1/staff/production/KITCHEN")
        return route.fulfill({
          json: created
            ? [
                {
                  id: "fixture-ticket",
                  orderId: id,
                  reference: "12345678",
                  version: 1,
                  status,
                  station: "KITCHEN",
                  orderType: "TAKEAWAY",
                  tableLabel: null,
                  createdAt: new Date().toISOString(),
                  items: [item],
                  canStart: status === "NEW",
                  canReady: status === "PREPARING",
                  canServe: status === "READY",
                },
              ]
            : [],
        });
      if (
        path === "/v1/staff/production-tickets/fixture-ticket/status" &&
        requestMethod === "PATCH"
      ) {
        status = route.request().postDataJSON().status;
        return route.fulfill({ json: {} });
      }
      if (path === "/v1/staff/pilot/orders")
        return route.fulfill({
          json: created
            ? [
                {
                  id,
                  reference: "12345678",
                  source: "COUNTER",
                  lifecycleStatus: "ACCEPTED",
                  productionStatus: status,
                  paymentStatus: paid ? "PAID" : "PENDING_PAYMENT",
                  totalMinor: 1400,
                  currency: "EUR",
                  createdAt: new Date().toISOString(),
                  receiptId: paid ? receipt.id : null,
                  paidMinor: paid ? 1400 : 0,
                  paymentMethods: paid ? [method] : [],
                  sessionPaymentMinor: 0,
                  canPay: !paid,
                  items: [item],
                  tickets: [],
                  canManage: true,
                  canProduce: true,
                  canComplete: false,
                },
              ]
            : [],
        });
      if (
        path === `/v1/staff/pos/orders/${id}/payment` &&
        requestMethod === "POST"
      ) {
        expect(route.request().postDataJSON()).toEqual(
          method === "CASH"
            ? { method, receivedMinor: 2000 }
            : { method, terminalConfirmed: true },
        );
        expect(route.request().headers()["idempotency-key"]).toBeTruthy();
        paid = true;
        return route.fulfill({ json: receipt });
      }
      if (path === `/v1/staff/receipts/${receipt.id}`)
        return route.fulfill({ json: receipt });
      if (requestMethod !== "GET")
        throw new Error(
          `Unexpected operational write: ${requestMethod} ${path}`,
        );
      return route.continue();
    });
    await page.goto("/en/staff/pos");
    await page
      .locator(".pos-product")
      .filter({ hasText: "Margherita" })
      .click();
    const modal = page.getByRole("dialog", { name: "Margherita", exact: true });
    await modal.getByRole("button", { name: /40 cm/ }).click();
    await modal.getByLabel("Kitchen note (optional)").fill(item.notes);
    await modal.getByRole("button", { name: "Add", exact: true }).click();
    await page.locator(".pos-submit").click();
    await page
      .locator(".pos-confirmation")
      .getByRole("button", { name: "New order", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Operations" })
      .getByRole("link", { name: "Kitchen", exact: true })
      .click();
    const ticket = page.locator(
      '.pilot-ticket[data-order-reference="12345678"]',
    );
    await expect(ticket).toContainText(item.notes);
    await ticket
      .getByRole("button", { name: "Start preparing", exact: true })
      .click();
    await ticket
      .getByRole("button", { name: "Mark ready", exact: true })
      .click();
    await expect(ticket).toHaveClass(/status-READY/);
    await page
      .getByRole("navigation", { name: "Operations" })
      .getByRole("link", { name: "Orders", exact: true })
      .click();
    await page
      .locator('[data-order-reference="12345678"]')
      .getByRole("button", { name: "Open order" })
      .click();
    const detail = page.locator(".simple-order-detail");
    if (method === "CASH") {
      await detail.getByLabel("Amount received").fill("20.00");
      await detail
        .getByRole("button", { name: "Confirm cash payment" })
        .click();
    } else {
      await detail.getByRole("button", { name: "Card", exact: true }).click();
      await detail.getByRole("checkbox").check();
      await detail.getByRole("button", { name: /Confirm card/ }).click();
    }
    await expect(
      detail.getByRole("heading", { name: /Receipt #UI-FIXTURE/ }),
    ).toBeVisible();
    await detail.getByRole("link", { name: "Open receipt" }).click();
    await expect(page.getByTestId("receipt-total")).toContainText("14.00");
    await expect(page.locator(".receipt-items")).toContainText("40 cm");
  });
}
