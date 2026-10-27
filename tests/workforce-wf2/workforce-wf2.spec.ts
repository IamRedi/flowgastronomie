import { test, expect, type Page, type Browser } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { workforceOperationsCopy } from "../../apps/web/components/workforce/operations-copy";
const api = "http://localhost:4404";
async function actors(locale: string) {
  return JSON.parse(
    await readFile("artifacts/workforce-wf2/actors.json", "utf8"),
  )[locale];
}
async function login(page: Page, actor: any) {
  const r = await page.request.post(api + "/v1/auth/login", {
    data: {
      tenantSlug: actor.tenantSlug,
      venueSlug: actor.venueSlug,
      email: actor.email,
      password: actor.password,
    },
  });
  expect(r.ok()).toBe(true);
}
async function advance(page: Page, now: string) {
  const r = await page.request.post(api + "/__fixture/workforce-wf2/clock", {
    data: { now },
  });
  expect(r.ok()).toBe(true);
}
async function open(page: Page, locale: string) {
  await page.goto("/" + locale + "/staff/schedule?date=2030-08-12");
  await expect(
    page.getByTestId("wf2-workspace").getByRole("tablist"),
  ).toBeVisible({ timeout: 60000 });
}
async function refresh(page: Page, locale: "en" | "de" | "it" | "sq") {
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/workforce/operations?") && r.status() === 200,
    ),
    page
      .getByTestId("wf2-workspace")
      .getByRole("button", {
        name: workforceOperationsCopy[locale].refresh,
        exact: true,
      })
      .click(),
  ]);
}
async function ops(page: Page) {
  const r = await page.request.get(
    api + "/v1/staff/workforce/operations?from=2030-08-12&to=2030-08-31",
  );
  expect(r.ok()).toBe(true);
  return r.json();
}
async function managerPage(browser: Browser, actor: any, locale: string) {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  await login(page, actor);
  await open(page, locale);
  return { context, page };
}
for (const locale of ["sq", "de", "en", "it"] as const) {
  test(
    locale +
      ": real attendance day, break, correction, leave, coworker swap and canonical open claim",
    async ({ page, browser }) => {
      const a = await actors(locale),
        c = workforceOperationsCopy[locale],
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await advance(page, "2030-08-12T07:00:00.000Z");
      await login(page, a.worker);
      await page.setViewportSize({
        width:
          locale === "sq"
            ? 360
            : locale === "en"
              ? 390
              : locale === "it"
                ? 768
                : 1440,
        height: 1000,
      });
      await open(page, locale);
      const panel = page.getByTestId("wf2-workspace");
      await panel.getByRole("tab", { name: c.today, exact: true }).click();
      await panel.getByRole("button", { name: c.clockIn, exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(
        panel.getByRole("button", { name: c.startBreak, exact: true }),
      ).toBeVisible();
      let data = await ops(page);
      const id = data.current.id;
      expect(data.current.events[0].occurredAt).toBe(
        "2030-08-12T07:00:00.000Z",
      );
      await advance(page, "2030-08-12T10:00:00.000Z");
      await refresh(page, locale);
      await panel
        .getByRole("button", { name: c.startBreak, exact: true })
        .click();
      await expect(
        panel.getByRole("button", { name: c.endBreak, exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: "artifacts/workforce-wf2/employee-" + locale + "-break.png",
        fullPage: true,
      });
      await advance(page, "2030-08-12T10:30:00.000Z");
      await refresh(page, locale);
      await panel
        .getByRole("button", { name: c.endBreak, exact: true })
        .click();
      await expect(
        panel.getByRole("button", { name: c.clockOut, exact: true }),
      ).toBeVisible();
      await advance(page, "2030-08-12T15:00:00.000Z");
      await refresh(page, locale);
      await panel
        .getByRole("button", { name: c.clockOut, exact: true })
        .click();
      await expect(
        panel.getByRole("button", { name: c.clockIn, exact: true }),
      ).toBeVisible();
      data = await ops(page);
      const original = data.attendance.find((x: { id: string }) => x.id === id);
      expect(original.totals).toMatchObject({
        presenceMinutes: 480,
        breakMinutes: 30,
        workedMinutes: 450,
      });
      expect(original.events).toHaveLength(4);
      await advance(page, "2030-08-12T16:00:00.000Z");
      await refresh(page, locale);
      await panel.getByRole("tab", { name: c.hours, exact: true }).click();
      await panel
        .locator(".wf2-list")
        .getByRole("button", { name: c.requestCorrection, exact: true })
        .first()
        .click();
      let dialog = page.getByRole("dialog", { name: c.requestCorrection });
      await dialog
        .getByLabel(c.end, { exact: true })
        .first()
        .fill("2030-08-12T17:30");
      await dialog.getByRole("button", { name: c.submit, exact: true }).click();
      await expect(dialog).not.toBeVisible();
      const lead = await managerPage(browser, a.manager, locale),
        managerPanel = lead.page.getByTestId("wf2-workspace");
      await lead.page.screenshot({
        path: "artifacts/workforce-wf2/manager-" + locale + "-queue.png",
        fullPage: true,
      });
      const correctionCard = managerPanel.locator(".wf2-card").filter({
        has: lead.page.getByRole("heading", {
          name: c.requestCorrection,
          exact: true,
        }),
      });
      await correctionCard
        .getByRole("button", { name: c.review, exact: true })
        .click();
      dialog = lead.page.getByRole("dialog", { name: c.review });
      await expect(
        dialog.getByRole("heading", { name: c.original, exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("heading", { name: c.proposed, exact: true }),
      ).toBeVisible();
      await dialog
        .getByLabel(c.reason, { exact: true })
        .fill("Independent synthetic evidence review");
      await dialog.getByLabel(c.confirm, { exact: true }).check();
      await dialog.getByLabel(c.acknowledge, { exact: true }).check();
      await dialog
        .getByRole("button", { name: c.approve, exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      await refresh(page, locale);
      data = await ops(page);
      const corrected = data.attendance.find(
        (x: { id: string }) => x.id === id,
      );
      expect(corrected.approved.totals.workedMinutes).toBe(480);
      expect(corrected.original.endsAt).toBe("2030-08-12T15:00:00.000Z");
      expect(corrected.events).toHaveLength(5);
      await panel.getByRole("tab", { name: c.leave, exact: true }).click();
      const leaveForm = panel.locator("form").filter({
        has: page.getByRole("heading", { name: c.requestLeave, exact: true }),
      });
      await leaveForm.getByLabel(c.from, { exact: true }).fill("2030-08-20");
      await leaveForm.getByLabel(c.to, { exact: true }).fill("2030-08-20");
      await leaveForm.getByLabel(c.partial, { exact: true }).check();
      await leaveForm
        .getByLabel(c.start, { exact: true })
        .fill("2030-08-20T09:00");
      await leaveForm
        .getByLabel(c.end, { exact: true })
        .fill("2030-08-20T11:00");
      await leaveForm
        .getByRole("button", { name: c.submit, exact: true })
        .click();
      await expect(
        panel.locator(".wf2-card").filter({
          has: page.getByRole("heading", { name: c.annual, exact: true }),
        }),
      ).toBeVisible();
      await refresh(lead.page, locale);
      const leaveCard = managerPanel.locator(".wf2-card").filter({
        has: lead.page.getByRole("heading", { name: c.annual, exact: true }),
      });
      await leaveCard
        .getByRole("button", { name: c.review, exact: true })
        .click();
      dialog = lead.page.getByRole("dialog", { name: c.review });
      await expect(
        dialog.getByRole("heading", { name: c.impact, exact: true }),
      ).toBeVisible();
      await dialog
        .getByLabel(c.reason, { exact: true })
        .fill("Reviewed staffing impact");
      await dialog.getByLabel(c.confirm, { exact: true }).check();
      await dialog.getByLabel(c.acknowledge, { exact: true }).check();
      await dialog
        .getByRole("button", { name: c.approve, exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      await refresh(page, locale);
      expect((await ops(page)).balance.remainingMinutes).toBe(4680);
      await expect(
        panel.locator(".wf2-card").filter({
          has: page.getByRole("heading", { name: c.annual, exact: true }),
        }),
      ).toContainText(c.approved);
      await panel.getByRole("tab", { name: c.requests, exact: true }).click();
      const shiftForm = panel.locator("form").filter({
        has: page.getByRole("heading", { name: c.shiftRequest, exact: true }),
      });
      await shiftForm
        .getByLabel(c.category, { exact: true })
        .selectOption("SWAP");
      await shiftForm
        .getByLabel(c.shift, { exact: true })
        .selectOption(a.shiftIds[1]);
      await shiftForm
        .getByLabel(c.coworker, { exact: true })
        .selectOption(a.peer.membershipId);
      await shiftForm
        .getByLabel(c.otherShift, { exact: true })
        .selectOption(a.shiftIds[2]);
      await shiftForm
        .getByRole("button", { name: c.submit, exact: true })
        .click();
      const peer = await managerPage(browser, a.peer, locale);
      await peer.page
        .getByTestId("wf2-workspace")
        .getByRole("tab", { name: c.requests, exact: true })
        .click();
      await peer.page
        .getByTestId("wf2-workspace")
        .getByRole("button", { name: c.accept, exact: true })
        .click();
      await refresh(lead.page, locale);
      const swapCard = managerPanel.locator(".wf2-card").filter({
        has: lead.page.getByRole("heading", { name: c.swap, exact: true }),
      });
      await swapCard
        .getByRole("button", { name: c.review, exact: true })
        .click();
      dialog = lead.page.getByRole("dialog", { name: c.review });
      await dialog
        .getByLabel(c.reason, { exact: true })
        .fill("Reviewed qualified exchange");
      await dialog.getByLabel(c.confirm, { exact: true }).check();
      await dialog.getByLabel(c.acknowledge, { exact: true }).check();
      await dialog
        .getByRole("button", { name: c.approve, exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      await refresh(page, locale);
      data = await ops(page);
      expect(
        data.shifts.some(
          (x: { assignmentId: string }) => x.assignmentId === a.shiftIds[1],
        ),
      ).toBe(false);
      expect(
        data.shifts.find(
          (x: { assignmentId: string }) => x.assignmentId === a.shiftIds[2],
        ).userId,
      ).toBe(a.worker.userId);
      await shiftForm
        .getByLabel(c.category, { exact: true })
        .selectOption("OPEN");
      await shiftForm
        .getByLabel(c.shift, { exact: true })
        .selectOption(a.shiftIds[3]);
      await shiftForm
        .getByRole("button", { name: c.submit, exact: true })
        .click();
      await refresh(lead.page, locale);
      const openCard = managerPanel.locator(".wf2-card").filter({
        has: lead.page.getByRole("heading", { name: c.open, exact: true }),
      });
      await openCard
        .getByRole("button", { name: c.review, exact: true })
        .click();
      dialog = lead.page.getByRole("dialog", { name: c.review });
      await dialog
        .getByLabel(c.reason, { exact: true })
        .fill("Reviewed qualified open claim");
      await dialog.getByLabel(c.confirm, { exact: true }).check();
      await dialog.getByLabel(c.acknowledge, { exact: true }).check();
      await dialog
        .getByRole("button", { name: c.approve, exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      await refresh(page, locale);
      expect(
        (await ops(page)).shifts.find(
          (x: { assignmentId: string }) => x.assignmentId === a.shiftIds[3],
        ).userId,
      ).toBe(a.worker.userId);
      for (const width of [360, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await panel.getByRole("tab", { name: c.hours, exact: true }).click();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        ).toBe(true);
        await page.screenshot({
          path:
            "artifacts/workforce-wf2/employee-" + locale + "-" + width + ".png",
          fullPage: true,
        });
      }
      await expect(panel).not.toContainText("Synthetic private contract");
      expect(errors).toEqual([]);
      await peer.context.close();
      await lead.context.close();
    },
  );
}
test("real committed clock retry survives lost response and keyboard tab navigation", async ({
  page,
}) => {
  const a = await actors("en"),
    c = workforceOperationsCopy.en;
  await advance(page, "2030-08-13T07:00:00.000Z");
  await login(page, a.worker);
  await open(page, "en");
  const panel = page.getByTestId("wf2-workspace");
  await panel.getByRole("tab", { name: c.today, exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    panel.getByRole("tab", { name: c.hours, exact: true }),
  ).toBeFocused();
  await panel.getByRole("tab", { name: c.today, exact: true }).click();
  let committedBody: any;
  await page.route("**/v1/staff/workforce/attendance/punch", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    committedBody = route.request().postDataJSON();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort("failed");
  });
  await panel.getByRole("button", { name: c.clockIn, exact: true }).click();
  await expect(
    panel.getByRole("button", { name: c.retry, exact: true }),
  ).toBeVisible();
  await page.unroute("**/v1/staff/workforce/attendance/punch");
  await panel.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(
    panel.getByRole("button", { name: c.clockOut, exact: true }),
  ).toBeVisible();
  const current = (await ops(page)).current;
  expect(current.events).toHaveLength(1);
  expect(committedBody).not.toHaveProperty("occurredAt");
  expect(current.events[0].occurredAt).toBe("2030-08-13T07:00:00.000Z");
  for (const button of await panel.getByRole("button").all()) {
    if (await button.isVisible()) {
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
  }
  await advance(page, "2030-08-13T08:00:00.000Z");
  await refresh(page, "en");
  await panel.getByRole("button", { name: c.clockOut, exact: true }).click();
});
test("two real manager dialogs detect stale approval, preserve the first decision and recover by refresh", async ({
  page,
  browser,
}) => {
  const a = await actors("en"),
    c = workforceOperationsCopy.en;
  await login(page, a.peer);
  await open(page, "en");
  let panel = page.getByTestId("wf2-workspace");
  await panel.getByRole("tab", { name: c.leave, exact: true }).click();
  const form = panel.locator("form");
  await form.getByLabel(c.category, { exact: true }).selectOption("UNPAID");
  await form.getByLabel(c.from, { exact: true }).fill("2030-08-22");
  await form.getByLabel(c.to, { exact: true }).fill("2030-08-22");
  await form.getByRole("button", { name: c.submit, exact: true }).click();
  const one = await managerPage(browser, a.manager, "en"),
    two = await managerPage(browser, a.owner, "en");
  for (const p of [one.page, two.page]) {
    const card = p
      .getByTestId("wf2-workspace")
      .locator(".wf2-card")
      .filter({
        has: p.getByRole("heading", { name: c.unpaidLeave, exact: true }),
      });
    await card.getByRole("button", { name: c.review, exact: true }).click();
    const dialog = p.getByRole("dialog", { name: c.review });
    await dialog
      .getByLabel(c.reason, { exact: true })
      .fill("Independent operational decision");
    await dialog.getByLabel(c.confirm, { exact: true }).check();
    await dialog.getByLabel(c.acknowledge, { exact: true }).check();
  }
  await one.page
    .getByRole("dialog")
    .getByRole("button", { name: c.approve, exact: true })
    .click();
  await expect(one.page.getByRole("dialog")).not.toBeVisible();
  await two.page
    .getByRole("dialog")
    .getByRole("button", { name: c.approve, exact: true })
    .click();
  await expect(two.page.getByRole("dialog").getByRole("alert")).toHaveText(
    c.conflict,
  );
  await two.page.screenshot({
    path: "artifacts/workforce-wf2/manager-conflict.png",
    fullPage: true,
  });
  await two.page
    .getByRole("dialog")
    .getByRole("button", { name: c.close, exact: true })
    .click();
  await refresh(two.page, "en");
  const requests = (await ops(page)).requests.filter(
    (r: { userId: string; kind: string; startsAt: string }) =>
      r.userId === a.peer.userId &&
      r.kind === "LEAVE" &&
      r.startsAt.startsWith("2030-08-21"),
  );
  expect(requests).toHaveLength(1);
  expect(requests[0].status).toBe("APPROVED");
  expect(requests[0].transitions).toHaveLength(2);
  await one.context.close();
  await two.context.close();
});

test("manager recovers offboarded work with an independent owner approval and immutable evidence", async ({
  page,
  browser,
}) => {
  const a = await actors("en"),
    c = workforceOperationsCopy.en;
  await advance(page, "2030-08-13T09:00:00.000Z");
  const owner = await managerPage(browser, a.owner, "en");
  const disabled = await owner.page.request.patch(
    api + "/v1/staff/team/members/" + a.bar.membershipId,
    { data: { active: false } },
  );
  expect(disabled.ok()).toBe(true);
  await login(page, a.manager);
  await open(page, "en");
  const panel = page.getByTestId("wf2-workspace"),
    card = panel.locator(".wf2-card").filter({
      has: page.getByRole("heading", { name: "Crew C", exact: true }),
    });
  await card
    .getByRole("button", { name: c.requestCorrection, exact: true })
    .click();
  let dialog = page.getByRole("dialog", { name: c.requestCorrection });
  await dialog
    .getByLabel(c.end, { exact: true })
    .first()
    .fill("2030-08-12T17:00");
  await dialog.getByRole("button", { name: c.submit, exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const ownProposal = panel.locator(".wf2-card").filter({
    has: page.getByRole("heading", {
      name: c.requestCorrection,
      exact: true,
    }),
  });
  await expect(
    ownProposal.getByRole("button", { name: c.review, exact: true }),
  ).toBeDisabled();
  await refresh(owner.page, "en");
  const review = owner.page
    .getByTestId("wf2-workspace")
    .locator(".wf2-card")
    .filter({
      has: owner.page.getByRole("heading", {
        name: c.requestCorrection,
        exact: true,
      }),
    });
  await review.getByRole("button", { name: c.review, exact: true }).click();
  dialog = owner.page.getByRole("dialog", { name: c.review });
  await dialog
    .getByLabel(c.reason, { exact: true })
    .fill("Independently reviewed offboarding recovery");
  await dialog.getByLabel(c.confirm, { exact: true }).check();
  await dialog.getByLabel(c.acknowledge, { exact: true }).check();
  await owner.page.screenshot({
    path: "artifacts/workforce-wf2/manager-recovery-review.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: c.approve, exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const data = await ops(owner.page),
    record = data.attendance.find(
      (r: { userId: string }) => r.userId === a.bar.userId,
    );
  expect(record.state).toBe("CLOSED");
  expect(record.events.map((e: { kind: string }) => e.kind)).toEqual([
    "CLOCK_IN",
    "CORRECTION",
  ]);
  expect(record.approved.totals.workedMinutes).toBe(480);
  await owner.context.close();
});
