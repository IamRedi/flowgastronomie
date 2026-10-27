import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { workforceCopy } from "../../apps/web/components/workforce/copy";
const api = "http://localhost:4403";
async function actors() {
  return JSON.parse(await readFile("artifacts/workforce/actors.json", "utf8"));
}
async function login(page: Page, actor: string) {
  const a = (await actors())[actor];
  const response = await page.request.post(api + "/v1/auth/login", {
    data: {
      tenantSlug: a.tenantSlug,
      venueSlug: a.venueSlug,
      email: a.email,
      password: a.password,
    },
  });
  expect(response.ok()).toBe(true);
  return a;
}
async function workspace(page: Page) {
  const r = await page.request.get(
    api + "/v1/staff/workforce?from=2030-08-12&to=2030-08-31",
  );
  expect(r.ok()).toBe(true);
  return r.json();
}
async function open(page: Page, locale = "en") {
  await page.goto("/" + locale + "/staff/schedule?date=2030-08-12");
  await expect(page.locator(".wf-week-grid")).toBeVisible({ timeout: 60000 });
}
async function drag(page: Page, handle: any, target: any) {
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox(),
    to = await target.boundingBox();
  expect(box).toBeTruthy();
  expect(to).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + 40, { steps: 12 });
  await page.mouse.up();
}
async function publish(page: Page, locale = "en") {
  const c = workforceCopy[locale as "en" | "de" | "sq" | "it"];
  await page.getByRole("button", { name: c.review, exact: true }).click();
  await expect(page.locator(".wf-review")).toBeVisible();
  await page.getByLabel(c.confirmed, { exact: true }).check();
  await page
    .locator(".wf-review")
    .getByRole("button", { name: c.republish, exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText(c.publishedSuccess);
}
for (const locale of ["sq", "de", "en", "it"] as const)
  test(
    locale +
      ": real pointer move, resize, three views, review/republish and employee privacy",
    async ({ page, browser }) => {
      const c = workforceCopy[locale],
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setViewportSize({ width: 1440, height: 1200 });
      const actor = await login(page, "manager"),
        crew = (await actors()).worker,
        peer = (await actors()).peer;
      await open(page, locale);
      const before = await workspace(page),
        s = before.schedules.find((s: any) => s.week === "2030-08-12"),
        a = s.snapshot.assignments.find(
          (a: any) =>
            a.membershipId === crew.membershipId &&
            a.startsLocal.slice(0, 10) === "2030-08-12",
        );
      if (!a) throw new Error("Fixture shift absent");
      const card = page.getByTestId("shift-" + a.id),
        target = page.locator(
          '[data-wf-drop-day="2030-08-17"][data-wf-drop-member="' +
            peer.membershipId +
            '"]',
        );
      // Restore a known source day for each locale without replacing its identity.
      await drag(
        page,
        card.getByRole("button", {
          name: c.move + ": " + crew.displayName,
          exact: true,
        }),
        target,
      );
      await expect
        .poll(async () => {
          const r = await workspace(page);
          return r.schedules
            .find((s: any) => s.week === "2030-08-12")
            .snapshot.assignments.find((x: any) => x.id === a.id)?.membershipId;
        })
        .toBe(peer.membershipId);
      const after = await workspace(page),
        changed = after.schedules
          .find((s: any) => s.week === "2030-08-12")
          .snapshot.assignments.find((x: any) => x.id === a.id);
      expect(changed.startsLocal.slice(0, 10)).toBe("2030-08-17");
      const moved = page.getByTestId("shift-" + a.id),
        resize = moved.getByRole("button", {
          name: c.resize + ": " + peer.displayName,
          exact: true,
        });
      // The server can commit before the client finishes loading the moved card.
      // Its body remains disabled while busy, and pointer start deliberately
      // refuses that state. Wait for the real UI before the next gesture.
      await expect(moved.locator(".wf-card-body")).toBeEnabled();
      await resize.scrollIntoViewIfNeeded();
      const box = await resize.boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box!.x + box!.width / 2,
        box!.y + box!.height / 2 + 16,
        { steps: 6 },
      );
      await page.mouse.up();
      await expect
        .poll(async () => {
          const r = await workspace(page);
          return r.schedules
            .find((s: any) => s.week === "2030-08-12")
            .snapshot.assignments.find((x: any) => x.id === a.id).endsLocal;
        })
        .toBe("2030-08-17T17:30");
      await page.getByRole("button", { name: c.day, exact: true }).click();
      await expect(page.locator(".wf-day")).toBeVisible();
      await page.getByLabel(c.date, { exact: true }).fill("2030-08-17");
      await expect(
        page
          .locator(".wf-day-shift")
          .filter({ hasText: peer.displayName })
          .first(),
      ).toBeVisible();
      await page.getByRole("button", { name: c.month, exact: true }).click();
      await expect(page.locator(".wf-month-summary")).toContainText(
        peer.displayName,
      );
      await page.getByRole("button", { name: c.week, exact: true }).click();
      await publish(page, locale);
      const workerContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      });
      const workerPage = await workerContext.newPage();
      await login(workerPage, "worker");
      await workerPage.goto("/" + locale + "/staff/schedule?date=2030-08-12");
      await expect(
        workerPage
          .locator(".wf-workspace")
          .getByRole("heading", { name: c.mine, exact: true }),
      ).toBeVisible();
      await expect(workerPage.locator(".wf-workspace")).not.toContainText(
        peer.workEmail ?? peer.email,
      );
      expect(
        await workerPage
          .locator(".wf-workspace")
          .evaluate((el) => el.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const own = await workspace(workerPage);
      expect(own.profiles).toHaveLength(1);
      expect(
        own.schedules
          .flatMap((s: any) => s.snapshot.assignments)
          .every((x: any) => x.userId === crew.userId),
      ).toBe(true);
      expect(own.history).toEqual([]);
      await workerPage.screenshot({
        path: "artifacts/workforce/" + locale + "-employee-390.png",
        fullPage: true,
        style: "nextjs-portal{display:none!important}",
      });
      await workerContext.close();
      await page.screenshot({
        path: "artifacts/workforce/" + locale + "-manager-1440.png",
        fullPage: true,
        style: "nextjs-portal{display:none!important}",
      });
      expect(errors).toEqual([]);
      // Put the same shift back for the next locale; this is a real versioned server write.
      const restore = await workspace(page),
        schedule = restore.schedules.find((s: any) => s.week === "2030-08-12");
      const payload = schedule.snapshot.assignments.map((x: any) => {
        const { userId, role, displayName, startsAt, endsAt, ...v } = x;
        return x.id === a.id
          ? {
              ...v,
              membershipId: crew.membershipId,
              startsLocal: "2030-08-12T09:00",
              endsLocal: "2030-08-12T17:00",
            }
          : v;
      });
      const reset = await page.request.put(
        api + "/v1/staff/workforce/schedule",
        {
          data: {
            week: "2030-08-12",
            expectedVersion: schedule.version,
            status: "PUBLISHED",
            reviewConfirmed: true,
            assignments: payload,
          },
        },
      );
      expect(reset.ok()).toBe(true);
    },
  );
test("keyboard edits, professional profile history, private certificate and reusable templates", async ({
  page,
}) => {
  const c = workforceCopy.en;
  await login(page, "owner");
  await open(page);
  await page.getByRole("button", { name: c.myProfile, exact: true }).click();
  const profile = page.getByRole("dialog");
  await profile.getByLabel(c.phone, { exact: true }).fill("+49 30 0000009");
  await profile
    .getByRole("button", { name: c.save, exact: true })
    .first()
    .click();
  await expect(profile.locator(".wf-muted")).toContainText("Version 1");
  await profile.getByText(c.history, { exact: true }).click();
  await expect(
    profile.locator(".wf-contract").filter({ hasText: "0000009" }),
  ).toBeVisible();
  await profile
    .getByLabel(c.documentTitle, { exact: true })
    .fill("Synthetic training certificate");
  await profile
    .getByLabel(c.file, { exact: true })
    .setInputFiles("tests/foundation/synthetic-logo.jpg");
  await profile.getByRole("button", { name: c.upload, exact: true }).click();
  await expect(
    profile
      .locator(".wf-contract")
      .filter({ hasText: "Synthetic training certificate" }),
  ).toBeVisible();
  await profile.getByRole("button", { name: c.close, exact: true }).click();
  const a = (await workspace(page)).schedules
    .find((s: any) => s.week === "2030-08-12")
    .snapshot.assignments.find(
      (a: any) => a.startsLocal === "2030-08-12T09:00",
    );
  const card = page.getByTestId("shift-" + a.id);
  await card
    .getByRole("button", { name: c.move + ": " + a.displayName, exact: true })
    .focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: c.edit });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(c.end, { exact: true }).fill("2030-08-12T17:15");
  await dialog.getByRole("button", { name: c.save, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator(".wf-tools summary").click();
  await page.getByRole("button", { name: c.template, exact: true }).click();
  const template = page.getByRole("dialog", { name: c.template });
  await template
    .getByLabel(c.templateName, { exact: true })
    .fill("Keyboard service");
  await template.getByLabel(c.station, { exact: true }).selectOption("SERVICE");
  await template.getByRole("button", { name: c.save, exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Keyboard service", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Keyboard service", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: c.edit })).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: c.close, exact: true })
    .click();
});
test("real touch input saves a move and layouts remain readable at 360/390/768/1440", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 768, height: 1100 },
    hasTouch: true,
  });
  const page = await context.newPage();
  const c = workforceCopy.en;
  await login(page, "manager");
  const fixture = await actors(),
    before = await workspace(page),
    schedule = before.schedules.find((s: any) => s.week === "2030-08-12"),
    id = crypto.randomUUID();
  const existing = schedule.snapshot.assignments.map((x: any) => {
    const { userId, displayName, role, startsAt, endsAt, ...a } = x;
    return a;
  });
  const save = await page.request.put(api + "/v1/staff/workforce/schedule", {
    data: {
      week: "2030-08-12",
      expectedVersion: schedule.version,
      status: "DRAFT",
      reviewConfirmed: false,
      assignments: [
        ...existing,
        {
          id,
          membershipId: fixture.worker.membershipId,
          station: "SERVICE",
          startsLocal: "2030-08-12T00:00",
          endsLocal: "2030-08-12T04:00",
          startChoice: "reject",
          endChoice: "reject",
          breakMinutes: 0,
          requiredSkills: [],
          note: "Touch fixture",
        },
      ],
    },
  });
  expect(save.ok()).toBe(true);
  await open(page);
  const handle = page.getByTestId("shift-" + id).getByRole("button", {
      name: c.move + ": " + fixture.worker.displayName,
      exact: true,
    }),
    target = page.locator(
      '[data-wf-drop-day="2030-08-13"][data-wf-drop-member="' +
        fixture.peer.membershipId +
        '"]',
    );
  await target.scrollIntoViewIfNeeded();
  await handle.scrollIntoViewIfNeeded();
  const a = await handle.boundingBox(),
    b = await target.boundingBox();
  expect(a).toBeTruthy();
  expect(b).toBeTruthy();
  const cdp = await context.newCDPSession(page),
    start = { x: a!.x + a!.width / 2, y: a!.y + a!.height / 2 },
    end = { x: b!.x + b!.width / 2, y: b!.y + 40 };
  expect(start.x).toBeGreaterThan(0);
  expect(start.y).toBeGreaterThan(0);
  expect(end.x).toBeLessThan(768);
  expect(end.y).toBeLessThan(1100);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...start, id: 1 }],
  });
  for (let i = 1; i <= 12; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: start.x + ((end.x - start.x) * i) / 12,
          y: start.y + ((end.y - start.y) * i) / 12,
          id: 1,
        },
      ],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(async () => {
      const w = await workspace(page);
      return w.schedules
        .find((s: any) => s.week === "2030-08-12")
        .snapshot.assignments.find((a: any) => a.id === id).membershipId;
    })
    .toBe(fixture.peer.membershipId);
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "artifacts/workforce/manager-responsive-" + width + ".png",
      fullPage: true,
      style: "nextjs-portal{display:none!important}",
    });
  }
  await context.close();
});
test("two browser managers keep draft private and recover an optimistic conflict", async ({
  page,
  browser,
}) => {
  const c = workforceCopy.en;
  await login(page, "manager");
  await open(page);
  const context = await browser.newContext(),
    other = await context.newPage();
  await login(other, "owner");
  await open(other);
  const before = await workspace(page),
    a = before.schedules
      .find((s: any) => s.week === "2030-08-12")
      .snapshot.assignments.find(
        (a: any) => a.startsLocal === "2030-08-14T09:00",
      );
  await page
    .getByTestId("shift-" + a.id)
    .getByRole("button", {
      name: c.edit + ": " + a.displayName + " " + a.startsLocal,
      exact: true,
    })
    .click();
  let dialog = page.getByRole("dialog", { name: c.edit });
  await dialog.getByLabel(c.note, { exact: true }).fill("Manager one draft");
  await dialog.getByRole("button", { name: c.save, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await other
    .getByTestId("shift-" + a.id)
    .getByRole("button", {
      name: c.edit + ": " + a.displayName + " " + a.startsLocal,
      exact: true,
    })
    .click();
  dialog = other.getByRole("dialog", { name: c.edit });
  await dialog
    .getByLabel(c.note, { exact: true })
    .fill("Manager two stale draft");
  await dialog.getByRole("button", { name: c.save, exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(c.conflict);
  await dialog.getByRole("button", { name: c.reload, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const employee = await context.newPage();
  await login(employee, "worker");
  const own = await workspace(employee);
  expect(JSON.stringify(own.schedules)).not.toContain("Manager one draft");
  expect(JSON.stringify(own.schedules)).not.toContain(
    "Manager two stale draft",
  );
  await context.close();
});
test.afterAll(async () => {
  await mkdir("artifacts/workforce", { recursive: true });
  await writeFile(
    "artifacts/workforce/acceptance.json",
    JSON.stringify({
      schemaVersion: 1,
      scope: "WF1",
      database: "isolated local schema",
      businessRegistration: "real public registration",
      browser: "actual Next/React, pointer + touch input",
      locales: ["sq", "de", "en", "it"],
      viewportWidths: [360, 390, 768, 1440],
      providerCalls: 0,
      productionWrites: 0,
    }),
  );
});
