import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { instantiateCreativeTemplate } from "../../packages/domain/src/creative-templates";
import type { DesignDocument } from "../../packages/domain/src/creative";
test("CS6 reviewed AI, manual edit, Story/A4 adaptation, export and responsive evidence", async ({
  page,
}) => {
  let document = instantiateCreativeTemplate(
    "Product spotlight",
    "SOCIAL",
    "en",
    [
      {
        id: "name",
        sourceType: "PRODUCT",
        sourceId: "pizza",
        field: "name",
        version: "v1",
        value: "Margherita",
      },
      {
        id: "price",
        sourceType: "PRODUCT",
        sourceId: "pizza",
        field: "price",
        version: "v1",
        value: "€10.50",
      },
    ],
  );
  let version = 0;
  let title = "Margherita spotlight";
  const exports: { id: string; outputType: string; createdAt: string }[] = [];
  const project = () => ({
    id: "project",
    title,
    format: document.format,
    locale: "en",
    status: "DRAFT",
    document,
    version,
  });
  await page.route("http://localhost:4200/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const body = route.request().postDataJSON();
    let result: unknown = [];
    if (path === "/v1/staff/me")
      result = {
        staff: {
          role: "MANAGER",
          displayName: "Acceptance Manager",
          venueName: "Olive acceptance",
        },
      };
    if (path.endsWith("/capabilities"))
      result = { planner: true, images: false };
    if (path.endsWith("/sources"))
      result = {
        venue: { id: "venue", name: "Olive acceptance" },
        brand: { id: "brand", primaryColor: "#17382f", accentColor: "#b78b52" },
        products: [
          { id: "pizza", name: "Margherita", price: "€10.50", variants: [] },
        ],
        categories: [],
        tables: [],
        websiteAssets: [],
      };
    if (path.endsWith("/projects"))
      result = method === "POST" ? project() : [project()];
    if (path.endsWith("/projects/project")) {
      if (method === "PUT") {
        expect(body.expectedVersion).toBe(version);
        document = body.document;
        title = body.title;
        version++;
      }
      result = project();
    }
    if (path.endsWith("/ai"))
      result = {
        id: "suggestion",
        summary:
          "A simpler composition with only the product and its connected price.",
        baseVersion: version,
      };
    if (path.endsWith("/ai/accept")) {
      document = {
        ...document,
        pages: [
          {
            ...document.pages[0]!,
            layers: document.pages[0]!.layers.filter((l) => l.id !== "cta"),
          },
        ],
      };
      version++;
      result = project();
    }
    if (path.endsWith("/preflight"))
      result = {
        version,
        confirmationHash: "a".repeat(64),
        changes: [],
        warnings: [],
      };
    if (path.endsWith("/exports")) {
      if (method === "POST") {
        expect(body.expectedVersion).toBe(version);
        version++;
        const record = {
          id: `export_${exports.length}`,
          outputType: body.type,
          createdAt: "2026-10-07T10:00:00Z",
        };
        exports.push(record);
        result = { ...record, version };
      } else result = exports;
    }
    if (/\/exports\/export_\d+\/content/.test(path)) {
      await route.fulfill({
        body: readFileSync("docs/creative/fixtures/a4-poster.pdf"),
        contentType: "application/pdf",
        headers: {
          "Content-Disposition": "attachment; filename=acceptance.pdf",
        },
      });
      return;
    }
    await route.fulfill({ json: result });
  });
  await page.goto("/app/en/marketing/creative");
  await expect(
    page.getByRole("heading", { name: "Your next idea. Ready in four steps." }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/creative/screenshots/library-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Advanced editor" }).click();
  await page.getByText("✦ Design assistant", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Request", exact: true })
    .fill("Make this more minimal");
  await page.getByRole("button", { name: "Suggest a design" }).click();
  await page.getByRole("button", { name: "Apply suggestion" }).click();
  await expect(page.locator(".cs-layer-list li")).toHaveCount(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".cs-layer-list li")).toHaveCount(3);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByText("✦ Design assistant", { exact: true }).click();
  await page.getByRole("button", { name: "＋ Text", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Text", exact: true })
    .fill("Fresh from our kitchen");
  await page.getByLabel("Design format").selectOption("STORY");
  await page.getByLabel("Design format").selectOption("A4");
  await page.getByText("Preview & export", { exact: true }).click();
  await page.getByRole("button", { name: "Review export" }).click();
  const pngDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG", exact: true }).click();
  await pngDownload;
  await page.getByRole("button", { name: "Review export" }).click();
  await page.getByRole("combobox", { name: "File type" }).selectOption("PDF");
  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  await pdfDownload;
  expect(exports.map((e) => e.outputType)).toEqual(["PNG", "PDF"]);
  await page.getByText("Preview & export", { exact: true }).click();
  await page.screenshot({
    path: "docs/creative/screenshots/editor-desktop.png",
    fullPage: true,
  });
  for (const [name, width, height] of [
    ["tablet", 820, 1180],
    ["mobile", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({
      path: `docs/creative/screenshots/editor-${name}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
