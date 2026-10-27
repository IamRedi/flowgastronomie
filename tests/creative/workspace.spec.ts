import { test, expect } from "@playwright/test";
import {
  composeCreativeBrief,
  type CreativeBrief,
} from "../../packages/domain/src/creative-workspace";
import type { DesignDocument } from "../../packages/domain/src/creative";
test("four-step workspace keeps AI editable, exports and organizes versioned work on desktop and mobile", async ({
  page,
}) => {
  let project: {
    id: string;
    title: string;
    format: string;
    locale: string;
    document: DesignDocument;
    version: number;
    status: string;
    updatedAt: string;
  } | null = null;
  let exported = false,
    failed = false;
  await page.route("http://localhost:4200/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    const body = route.request().postDataJSON();
    let result: unknown = [];
    if (path === "/v1/staff/me")
      result = {
        staff: {
          displayName: "Manager",
          role: "MANAGER",
          venueName: "Olive acceptance",
        },
      };
    else if (path.endsWith("/capabilities"))
      result = { planner: true, images: false, imageProviders: [] };
    else if (path.endsWith("/sources"))
      result = {
        venue: { id: "venue", name: "Olive acceptance" },
        products: [{ id: "pizza", name: "Margherita", price: "€12.00" }],
        websiteAssets: [],
      };
    else if (path.endsWith("/compose")) {
      const brief = body as CreativeBrief;
      expect(brief.material).toBe("STICKER");
      project = {
        id: "wizard",
        title: "Sticker · Olive acceptance",
        format: "STICKER",
        locale: "en",
        version: 1,
        status: "DRAFT",
        updatedAt: new Date().toISOString(),
        document: composeCreativeBrief(
          brief,
          [
            {
              id: "venue",
              sourceType: "VENUE",
              sourceId: "venue",
              field: "name",
              value: "Olive acceptance",
              version: "v1",
            },
          ],
          [],
        ),
      };
      result = project;
    } else if (path.endsWith("/ai")) {
      expect(body.mode).toBe("PATCH");
      expect(body.expectedVersion).toBe(project!.version);
      if (failed) {
        await route.fulfill({
          status: 503,
          json: { message: "AI unavailable. Your design is unchanged." },
        });
        return;
      }
      result = {
        id: "proposal",
        summary: "Made the discount more prominent",
        proposal: {
          document: project!.document,
          baseVersion: project!.version,
        },
      };
    } else if (path.endsWith("/ai/accept")) {
      project!.version++;
      result = project;
    } else if (path.endsWith("/preview")) {
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="227" height="227"><rect width="227" height="227" fill="#fffdf7"/><text x="50" y="115" fill="#183a31" font-size="30">10% off</text></svg>',
      });
      return;
    } else if (path.endsWith("/preflight"))
      result = {
        version: project!.version,
        confirmationHash: "hash",
        changes: [],
        warnings: [],
      };
    else if (path.endsWith("/exports") && method === "POST") {
      exported = true;
      project!.version++;
      result = { id: "file" };
    } else if (path.endsWith("/exports/file/content")) {
      await route.fulfill({
        contentType: "application/pdf",
        headers: { "Content-Disposition": "attachment; filename=sticker.pdf" },
        body: "%PDF-1.4\n%%EOF",
      });
      return;
    } else if (path.endsWith("/projects"))
      result = project
        ? [
            {
              ...project,
              archiveState:
                project.status === "ARCHIVED"
                  ? "ARCHIVED"
                  : exported
                    ? "CURRENT"
                    : "DRAFT",
              latestExport: exported ? { id: "file", outputType: "PDF" } : null,
            },
          ]
        : [];
    else if (path.endsWith("/sync"))
      result = { project, updated: false, needsReview: false };
    else if (path.endsWith("/proposal")) result = null;
    else if (path.endsWith("/archive")) {
      project!.status = body.archived ? "ARCHIVED" : "DRAFT";
      result = project;
    } else if (path.endsWith("/projects/wizard")) result = project;
    await route.fulfill({ json: result });
  });
  await page.goto("/app/en/marketing/creative");
  await expect(
    page.getByRole("heading", { name: "Your next idea. Ready in four steps." }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/creative/screenshots/workspace-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "docs/creative/screenshots/workspace-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page
    .getByLabel("What would you like to create?")
    .fill("A minimal sticker with 10% off");
  await page.getByRole("button", { name: "Create my design" }).click();
  await page.getByRole("button", { name: "Keep this version" }).click();
  await expect(
    page.getByText("Saved automatically", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/creative/screenshots/workspace-review.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Looks good. Download" }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PDF PDF for printing", exact: false })
    .click();
  await download;
  await expect(
    page.getByRole("link", { name: "Your file is ready" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator(".cw-badge")).toContainText("Current");
  await page.screenshot({
    path: "docs/creative/screenshots/workspace-archive.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Archive design", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Return to workspace" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Return to workspace" }).click();
  await page.getByRole("button", { name: "Open design" }).click();
  failed = true;
  const savedVersion = project!.version;
  await page
    .getByRole("textbox", { name: "What should we change?" })
    .fill("Make the type larger");
  await page.getByRole("button", { name: "Suggest changes" }).click();
  await expect(page.locator(".cw-root").getByRole("alert")).toContainText(
    "Your design is unchanged",
  );
  expect(project!.version).toBe(savedVersion);
});
