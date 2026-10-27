import { expect, test, type Page } from "@playwright/test";

const apiOrigin = "http://localhost:4100";

async function signInAsManager(page: Page) {
  await page.goto("/en/staff/login");
  await page.locator('input[name="tenantSlug"]').fill("flowgastronomie-demo");
  await page.locator('input[name="venueSlug"]').fill("restaurant-olive");
  await page.locator('input[name="password"]').fill("Demo1234!");
  await page
    .locator('input[name="email"]')
    .fill("manager@flowgastronomie.local");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\/en\/overview$/);
}

async function expectAccessibleRoute(page: Page) {
  // Authenticated Home owns its page title in the shared platform header.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  const unnamedControls = await page
    .locator("button, input, select, textarea")
    .evaluateAll((controls) =>
      controls
        .filter((control) => {
          if (
            control instanceof HTMLInputElement &&
            control.type === "hidden"
          ) {
            return false;
          }
          const labels =
            control.getAttribute("aria-label") ||
            control.getAttribute("aria-labelledby") ||
            (control instanceof HTMLInputElement && control.labels?.length) ||
            control.textContent?.trim();
          return !labels;
        })
        .map((control) => control.outerHTML),
    );
  expect(unnamedControls).toEqual([]);

  const undersizedControls = await page
    .locator(
      "button:not([data-nextjs-dev-tools-button]), input:not([type=hidden]), select, textarea",
    )
    .evaluateAll((controls) =>
      controls
        .map((control) => {
          const box = control.getBoundingClientRect();
          return {
            height: box.height,
            name: control.getAttribute("name"),
            type:
              control instanceof HTMLInputElement
                ? control.type
                : control.tagName,
          };
        })
        .filter(
          (control) => control.type !== "checkbox" && control.type !== "radio",
        )
        .filter((control) => control.height > 0)
        .filter((control) => control.height < 44),
    );
  expect(undersizedControls).toEqual([]);

  await page.keyboard.press("Tab");
  const focusIndicator = await page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return false;
    const style = getComputedStyle(active);
    return (
      style.outlineStyle !== "none" ||
      style.outlineWidth !== "0px" ||
      style.boxShadow !== "none"
    );
  });
  expect(focusIndicator).toBe(true);
}

test("critical guest, staff and Owner routes meet the keyboard, semantic and touch baseline", async ({
  page,
}) => {
  for (const viewport of [
    { width: 360, height: 800 },
    { width: 768, height: 1024 },
  ]) {
    await test.step(`${viewport.width}px guest menu`, async () => {
      await page.setViewportSize(viewport);
      await page.goto("/en/menu/demo-table-07");
      // Streaming navigation may still show the route loading skeleton.
      await expect(
        page.getByRole("heading", { name: "Restaurant Olive" }),
      ).toBeVisible();
      await expectAccessibleRoute(page);
    });

    await test.step(`${viewport.width}px staff login`, async () => {
      await page.goto("/en/staff/login");
      for (const field of ["tenantSlug", "venueSlug", "email", "password"])
        await expect(page.locator(`input[name="${field}"]`)).toHaveValue("");
      await expectAccessibleRoute(page);
    });

    await test.step(`${viewport.width}px Owner overview`, async () => {
      await signInAsManager(page);
      await page.goto("/app/en/overview");
      await expectAccessibleRoute(page);
      const overview = await page.request.get(
        `${apiOrigin}/v1/workspace/overview`,
      );
      expect(overview.ok()).toBe(true);
      await page.context().clearCookies();
    });
  }
});
