import { test, expect } from "@playwright/test";
import { createDesign } from "../../packages/domain/src/creative";
test("CS2 creates a printed menu, warns on price changes and explicitly updates", async ({
  page,
}) => {
  const doc = createDesign("A4", "en");
  let price = "€10.50";
  const project = {
    id: "project_2",
    title: "Menu",
    format: "A4",
    locale: "en",
    version: 0,
    document: doc,
  };
  await page.route("http://localhost:4200/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON();
    let result: unknown = [];
    if (path === "/v1/staff/me")
      result = {
        staff: {
          displayName: "Manager",
          role: "MANAGER",
          venueName: "Test restaurant",
        },
      };
    if (path.endsWith("/projects"))
      result = route.request().method() === "POST" ? project : [project];
    if (path.endsWith("/projects/project_2")) {
      if (body)
        Object.assign(project, body, {
          version: project.version + 1,
          document: body.document,
        });
      result = project;
    }
    if (path.endsWith("/sources"))
      result = {
        venue: { id: "venue_1", name: "Test restaurant" },
        brand: null,
        products: [
          {
            id: "pizza",
            name: "Margherita",
            price,
            categoryId: "pizza_cat",
            variants: [],
          },
        ],
        categories: [],
        tables: [],
        websiteAssets: [],
      };
    if (path.endsWith("/sources/resolve"))
      result = {
        ...body.binding,
        value:
          body.binding.sourceType === "VENUE"
            ? "Test restaurant"
            : body.binding.field === "price"
              ? price
              : "Margherita",
        version: "v1",
      };
    if (path.endsWith("/sources/check")) {
      const previous = body.document.bindings.find(
        (b: { field: string }) => b.field === "price",
      );
      const current = { ...previous, value: price, version: "v2" };
      result = {
        resolved: body.document.bindings.map((b: { field: string }) =>
          b.field === "price" ? current : b,
        ),
        changes: [{ previous, current }],
      };
    }
    await route.fulfill({ json: result });
  });
  await page.goto("/app/en/marketing/creative");
  await page.getByRole("button", { name: "Advanced editor" }).click();
  await page.getByText("Sources & templates", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Template", exact: true })
    .selectOption("Printed menu");
  await page.getByLabel("Select menu products").selectOption("pizza");
  await page.getByRole("button", { name: "Apply template" }).click();
  await expect(page.locator(".cs-layer-list li")).toHaveCount(3);
  price = "€11.00";
  await page.getByRole("button", { name: "Check source freshness" }).click();
  await expect(page.getByText("€10.50 → €11.00")).toBeVisible();
  await page.getByRole("button", { name: "Update connected values" }).click();
  await expect(page.getByRole("status").first()).toContainText("Saved");
  expect(
    project.document.bindings.find((b) => b.field === "price")?.value,
  ).toBe("€11.00");
});
