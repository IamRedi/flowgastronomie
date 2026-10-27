import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, email: string) {
  await page.goto("/en/staff/login");
  await page.locator('input[name="tenantSlug"]').fill("flowgastronomie-demo");
  await page.locator('input[name="venueSlug"]').fill("restaurant-olive");
  await page.locator('input[name="password"]').fill("Demo1234!");
  await page.locator('input[name="email"]').fill(email);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Operations" }),
  ).toBeVisible();
}
test.use({ hasTouch: true });
const nav = (page: Page) =>
  page.getByRole("navigation", { name: "Operations" });
const shotStyle = "nextjs-portal { display: none !important; }";

// Read-only navigation verification: no orders, shifts, register or data changes.
test("one-click navigation, persistent rail and responsive shared shell", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, "manager@flowgastronomie.local");
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1024, height: 768 },
    { width: 1180, height: 820 },
  ]) {
    await page.setViewportSize(viewport);
    await nav(page).getByRole("link", { name: "Home", exact: true }).click();
    await page.evaluate(() => {
      localStorage.setItem("pilot-sidebar:v1", "collapsed");
      sessionStorage.removeItem("pilot-sidebar:area:v2");
    });
    await page.reload();
    await expect(page.locator(".pilot-app-shell")).toHaveClass(/is-expanded/);
    await expect(
      page.getByTestId("active-orders").locator("strong"),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBe(true);
    const routes = [
      ["Home", "/app/en/overview", "dashboard"],
      ["Counter", "/en/staff/pos", "pos"],
      ["Orders", "/en/staff/orders", "orders"],
      ["Kitchen", "/en/staff/kitchen", "kitchen"],
      ["Menu", "/en/staff/menu", "menu"],
      ["Website", "/app/en/website", "website"],
      ["Report", "/en/staff/reports", "report"],
      ["Settings", "/app/en/settings", "settings"],
      ["Home", "/app/en/overview", "home"],
    ];
    for (const [label, path, name] of routes) {
      if (viewport.width === 1180)
        await nav(page).getByRole("link", { name: label!, exact: true }).tap();
      else
        await nav(page)
          .getByRole("link", { name: label!, exact: true })
          .click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(nav(page)).toHaveCount(1);
      await expect(page.locator(".pilot-app-shell")).toHaveClass(
        label === "Home" ? /is-expanded/ : /is-collapsed/,
      );
      await expect(
        nav(page).getByRole("link", { name: label!, exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await expect(nav(page).locator('[aria-current="page"]')).toHaveCount(1);
      await expect(page.locator(".pilot-nav")).toHaveCount(0);
      await expect(page.locator("main").first()).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (["dashboard", "pos", "kitchen"].includes(name!)) {
        if (name === "dashboard") {
          await expect(
            page.getByTestId("active-orders").locator("strong"),
          ).not.toHaveText("—");
          await expect(page.locator(".app-platform-header h1")).toBeVisible();
        }
        if (name === "pos")
          await expect(page.locator(".pos-product").first()).toBeVisible();
        if (name === "kitchen")
          await expect(page.locator(".pilot-production h1")).toBeVisible();
        for (const state of ["open", "closed"]) {
          const isCollapsed = (await page
            .locator(".pilot-app-shell")
            .getAttribute("class"))!.includes("is-collapsed");
          if (isCollapsed !== (state === "closed"))
            await page.locator(".app-sidebar-toggle").click();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await expect(page.locator(".app-sidebar-toggle")).toHaveAttribute(
            "aria-expanded",
            state === "open" ? "true" : "false",
          );
          if (state === "open")
            await expect(
              nav(page).locator(".app-nav-label").first(),
            ).toBeVisible();
          const targets = await nav(page)
            .getByRole("link")
            .evaluateAll((elements) =>
              elements.map((el) => ({
                w: el.getBoundingClientRect().width,
                h: el.getBoundingClientRect().height,
              })),
            );
          expect(
            targets.every((target) => target.w >= 44 && target.h >= 44),
          ).toBe(true);
          await page.screenshot({
            path: `artifacts/refinement-navigation/${name}-${state}-${viewport.width}.png`,
            style: shotStyle,
          });
        }
      }
    }
    // Reload preserves the manual choice only within the current primary area.
    await page.reload();
    await expect(page.locator(".pilot-app-shell")).toHaveClass(/is-expanded/);
  }
  await page.locator(".app-user").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#desk-profile-menu a")).toHaveCount(0);
  await page
    .locator("#desk-profile-menu")
    .getByRole("button", { name: "Profile", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Profile" })).toContainText(
    "manager@flowgastronomie.local",
  );
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(nav(page)).toHaveCount(0);
  const opener = page.getByRole("button", { name: "Expand navigation" });
  await opener.click();
  const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await nav(page).getByRole("link", { name: "Counter", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/staff\/pos$/);
  await expect(drawer).toHaveCount(0);
  await opener.click();
  await nav(page).getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/en\/overview$/);
  await expect(drawer).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Kitchen has a useful Home without access to owner data", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const privileged: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/v1/workspace/overview"))
      privileged.push(request.url());
  });
  await login(page, "kitchen@flowgastronomie.local");
  await expect(nav(page).getByRole("link")).toHaveCount(2);
  await expect(page.locator(".pilot-app-shell")).toHaveClass(/is-collapsed/);
  await nav(page).getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator(".app-platform-header h1")).toHaveText("Home");
  await expect(page.locator(".pilot-app-shell")).toHaveClass(/is-expanded/);
  await expect(nav(page).getByRole("link")).toHaveCount(2);
  expect(privileged).toEqual([]);
  await nav(page).getByRole("link", { name: "Kitchen", exact: true }).click();
  await expect(page.locator(".pilot-production h1")).toHaveText("Kitchen");
});
