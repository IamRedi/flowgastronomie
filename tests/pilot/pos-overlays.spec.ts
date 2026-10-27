import { test, expect } from "@playwright/test";

// Local UI contracts only. All operational writes are intercepted; actual
// persistence/printing is covered separately by the isolated E2E suites.
for (const viewport of [
  { width: 1366, height: 768, touch: false },
  { width: 1024, height: 768, touch: false },
  { width: 1180, height: 820, touch: true },
  { width: 390, height: 844, touch: true },
]) {
  test(`one POS overlay at ${viewport.width}px${viewport.touch ? " touch" : ""}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport,
      hasTouch: viewport.touch,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://localhost:3000/en/staff/login");
    await page.locator('input[name="tenantSlug"]').fill("flowgastronomie-demo");
    await page.locator('input[name="venueSlug"]').fill("restaurant-olive");
    await page.locator('input[name="password"]').fill("Demo1234!");
    await page
      .locator('input[name="email"]')
      .fill("manager@flowgastronomie.local");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/overview$/);
    let orderNumber = 0;
    let paymentNumber = 0;
    let releaseOrder: (() => void) | undefined;
    await page.route("**/v1/staff/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
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
        return route.fulfill({
          json: {
            devices: [],
            canManage: true,
            canDrawer: false,
            simulatorEnabled: false,
          },
        });
      if (/\/hardware\/receipts\/overlay-receipt-\d+\/jobs$/.test(path))
        return route.fulfill({ json: [] });
      if (path === "/v1/staff/orders" && method === "POST") {
        orderNumber++;
        expect(route.request().postDataJSON().items[0].productId).toBe(
          "pilot-product-pizza-1",
        );
        // The second response arrives while a tool is open: it must replace it.
        if (orderNumber === 2)
          await new Promise<void>((resolve) => {
            releaseOrder = resolve;
          });
        return route.fulfill({
          json: {
            id: `overlay-fixture-${orderNumber}`,
            totalMinor: 950,
            currency: "EUR",
            tableLabel: null,
          },
        });
      }
      if (
        /\/pos\/orders\/overlay-fixture-\d+\/payment$/.test(path) &&
        method === "POST"
      ) {
        const payload = route.request().postDataJSON();
        paymentNumber++;
        expect(payload).toEqual(
          paymentNumber === 1
            ? { method: "CASH", receivedMinor: 1000 }
            : { method: "CARD_AT_COUNTER", terminalConfirmed: true },
        );
        expect(route.request().headers()["idempotency-key"]).toBeTruthy();
        return route.fulfill({
          json: {
            id: `overlay-receipt-${paymentNumber}`,
            number: `OVERLAY-${paymentNumber}`,
            orderId: `overlay-fixture-${orderNumber}`,
            grossMinor: 950,
            currency: "EUR",
            method: payload.method,
          },
        });
      }
      if (method !== "GET")
        throw new Error(`Unexpected write: ${method} ${path}`);
      return route.continue();
    });
    await page.goto("http://localhost:3000/en/staff/pos");
    await page.evaluate(() => {
      const state = window as Window & { maxPosDialogs?: number };
      state.maxPosDialogs = 0;
      new MutationObserver(() => {
        state.maxPosDialogs = Math.max(
          state.maxPosDialogs ?? 0,
          document.querySelectorAll("dialog[open]").length,
        );
      }).observe(document.body, {
        subtree: true,
        attributes: true,
        childList: true,
      });
    });
    const register = page.locator(".register-panel > .pos-tool-trigger");
    const hardware = page.getByRole("button", {
      name: "Hardware settings",
      exact: true,
    });
    const product = page
      .locator(".pos-product")
      .filter({ hasText: "Margherita" });
    const dialog = page.getByRole("dialog");
    const shot = async (name: string) =>
      page.screenshot({
        path: `artifacts/pos-overlays/${viewport.width}-${name}.png`,
        animations: "disabled",
        style: "nextjs-portal{display:none!important}",
      });
    const checkModal = async () => {
      await expect(dialog).toHaveCount(1);
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(true);
      const rect = (await dialog.boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(8);
      expect(rect.y).toBeGreaterThanOrEqual(8);
      expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width - 8);
      expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height - 8);
      expect(
        Math.abs(rect.x + rect.width / 2 - viewport.width / 2),
      ).toBeLessThan(2);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await product.evaluate((el) => (el as HTMLElement).focus());
      expect(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
      ).toBe(true);
    };
    const outside = async () => page.mouse.click(4, 4);
    await register.click();
    await checkModal();
    await expect(dialog.getByLabel("Counted cash")).toBeVisible();
    await shot("register");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(register).toBeFocused();
    await hardware.click();
    await checkModal();
    await shot("hardware");
    // Tab and reverse Tab cannot escape to the sticky cart underneath.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab");
      expect(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
      ).toBe(true);
    }
    await outside();
    await expect(dialog).toHaveCount(0);
    await expect(hardware).toBeFocused();
    await register.click();
    await outside();
    await expect(register).toBeFocused();
    await hardware.click();
    await page.keyboard.press("Escape");
    await expect(hardware).toBeFocused();
    await product.click();
    await checkModal();
    await shot("product");
    await dialog.locator(".pilot-dialog-header button").click();
    await expect(product).toBeFocused();
    await product.click();
    await page.keyboard.press("Escape");
    await expect(product).toBeFocused();
    await product.click();
    await outside();
    await expect(product).toBeFocused();
    for (const method of ["CASH", "CARD"] as const) {
      await product.click();
      await dialog.getByRole("button", { name: "Add", exact: true }).click();
      await page.locator(".pos-submit").click();
      if (method === "CARD") {
        await expect.poll(() => !!releaseOrder).toBe(true);
        await register.click();
        await expect(dialog).toHaveAccessibleName("Register");
        releaseOrder!();
      }
      await expect(dialog).toHaveAccessibleName("Order sent to the kitchen");
      await checkModal();
      const checkout = await dialog.elementHandle();
      await shot(`${method.toLowerCase()}-payment`);
      if (method === "CASH") {
        await dialog.getByLabel("Amount received").fill("10.00");
        await dialog
          .getByRole("button", { name: "Confirm cash payment" })
          .click();
      } else {
        await dialog.getByRole("button", { name: "Card", exact: true }).click();
        await expect(
          dialog.getByRole("button", { name: "Confirm card payment" }),
        ).toBeDisabled();
        await dialog.getByRole("checkbox").check();
        await shot("card-selected");
        await dialog
          .getByRole("button", { name: "Confirm card payment" })
          .click();
      }
      await expect(
        dialog.getByRole("heading", { name: /Receipt #OVERLAY-/ }),
      ).toBeVisible();
      expect(
        await checkout!.evaluate(
          (el) =>
            el.isConnected && el === document.querySelector("dialog[open]"),
        ),
      ).toBe(true);
      await checkModal();
      await shot(`${method.toLowerCase()}-receipt`);
      await expect(
        dialog.getByRole("link", { name: "Open receipt" }),
      ).toBeVisible();
      if (method === "CASH") await page.keyboard.press("Escape");
      else await outside();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "New order", exact: true }),
      ).toBeFocused();
    }
    expect(paymentNumber).toBe(2);
    expect(
      await page.evaluate(
        () => (window as Window & { maxPosDialogs?: number }).maxPosDialogs,
      ),
    ).toBe(1);
    expect(errors).toEqual([]);
    await context.close();
  });
}
