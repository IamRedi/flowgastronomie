import { test, expect } from "@playwright/test";
import { createDesign } from "../../packages/domain/src/creative";
test("CS1 manual editor creates layers, persists, undoes and adapts responsively", async ({
  page,
}) => {
  let project = {
    id: "project_1",
    title: "Untitled design",
    format: "SOCIAL",
    locale: "en",
    status: "DRAFT",
    version: 0,
    document: createDesign("SOCIAL", "en"),
    updatedAt: new Date().toISOString(),
  };
  await page.route("http://localhost:4200/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    let result: unknown = [];
    if (url.pathname.endsWith("/sources"))
      result = {
        venue: { id: "venue_1", name: "Test restaurant" },
        brand: null,
        products: [],
        categories: [],
        tables: [],
        websiteAssets: [],
      };
    if (url.pathname === "/v1/staff/me")
      result = {
        staff: {
          displayName: "Studio Manager",
          role: "MANAGER",
          email: "studio@example.test",
          tenantId: "t1",
          venueId: "v1",
          venueName: "Test restaurant",
        },
      };
    else if (url.pathname.endsWith("/projects") && method === "POST")
      result = project;
    else if (url.pathname.endsWith("/projects/project_1")) {
      if (method === "PUT") {
        const body = route.request().postDataJSON();
        expect(body.expectedVersion).toBe(project.version);
        project = {
          ...project,
          ...body,
          document: body.document,
          version: project.version + 1,
        };
      }
      result = project;
    }
    await route.fulfill({
      json: result,
      headers: {
        "Access-Control-Allow-Origin": "http://localhost:3400",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  });
  await page.goto("/app/en/marketing/creative");
  await page.getByRole("button", { name: "Advanced editor" }).click();
  await page.getByRole("button", { name: "＋ Text", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Text", exact: true })
    .fill("Fresh from our kitchen");
  await expect(page.getByRole("status")).toContainText("Saved", {
    timeout: 15000,
  });
  expect(project.document.pages[0]!.layers[0]).toMatchObject({
    text: "Fresh from our kitchen",
  });
  await page.getByRole("button", { name: "＋ Shape", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".cs-layer-list li")).toHaveCount(1);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator(".cs-layer-list li")).toHaveCount(2);
  await page.getByLabel("Design format").selectOption("A4");
  await page.getByRole("button", { name: "Save version", exact: true }).click();
  await expect(page.locator("canvas.lower-canvas")).toBeVisible();
  await page.screenshot({
    path: "docs/creative/screenshots/cs1-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.screenshot({
    path: "docs/creative/screenshots/cs1-tablet.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "properties", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/creative/screenshots/cs1-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
