import { test, expect, type Page, type Browser } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { workforceCopy } from "../../apps/web/components/workforce/copy";
import { workforceOperationsCopy } from "../../apps/web/components/workforce/operations-copy";
import { workforceMonthCopy } from "../../apps/web/components/workforce/month-copy";
import { instant, dayAdd } from "./oracle";
const api = "http://localhost:4406",
  weeks = [
    "2031-11-03",
    "2031-11-10",
    "2031-11-17",
    "2031-11-24",
    "2031-12-01",
    "2031-12-08",
    "2031-12-15",
    "2031-12-22",
  ];
const actors = async () =>
  JSON.parse(await readFile("artifacts/workforce-wf4/actors.json", "utf8"));
async function login(page: Page, a: any) {
  const r = await page.request.post(api + "/v1/auth/login", {
    data: {
      tenantSlug: a.tenantSlug,
      venueSlug: a.venueSlug,
      email: a.email,
      password: a.password,
    },
  });
  expect(r.ok(), await r.text()).toBe(true);
}
async function advance(page: Page, local: string) {
  const r = await page.request.post(api + "/__fixture/workforce-wf4/clock", {
    data: { now: new Date(instant(local)).toISOString() },
  });
  expect(r.ok(), await r.text()).toBe(true);
}
async function open(
  page: Page,
  locale: string,
  date: string,
  tab = "operations",
) {
  await page.goto(
    `/${locale}/staff/schedule?date=${date}&workforceTab=${tab}&workforceMonth=2031-03`,
  );
  await expect(page.getByTestId("wf2-workspace")).toBeVisible({
    timeout: 60000,
  });
}
async function refresh(page: Page, c: any) {
  const ready = page.waitForResponse(
    (r) => r.url().includes("/workforce/operations?") && r.status() === 200,
  );
  await page
    .getByTestId("wf2-workspace")
    .getByRole("button", { name: c.refresh, exact: true })
    .click();
  await ready;
}
async function uiPunch(
  page: Page,
  button: any,
  local: string,
  keyboard = false,
) {
  const ready = page.waitForResponse(
    (r) =>
      r.url().endsWith("/attendance/punch") && r.request().method() === "POST",
  );
  if (keyboard) {
    await button.focus();
    await page.keyboard.press("Enter");
  } else await button.tap();
  const r = await ready;
  expect(r.ok(), await r.text()).toBe(true);
  expect((await r.json()).occurredAt).toBe(
    new Date(instant(local)).toISOString(),
  );
}

async function drag(page: Page, handle: any, target: any) {
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  const to = await target.boundingBox();
  expect(box).toBeTruthy();
  expect(to).toBeTruthy();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 12 });
  await page.mouse.up();
}
async function approve(page: Page, c: any, button: any) {
  await button.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel(c.reason, { exact: true })
    .fill("Reviewed actual synthetic source and staffing impact");
  await dialog.getByLabel(c.confirm, { exact: true }).check();
  await dialog.getByLabel(c.acknowledge, { exact: true }).check();
  await dialog.getByRole("button", { name: c.approve, exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
for (const [li, locale] of (["sq", "de", "en", "it"] as const).entries())
  for (const bi of [0, 1])
    test(`${locale}: ${bi === 0 ? "DE" : "AL"} full-month business, premium manager and employee workflow`, async ({
      page,
      browser,
    }) => {
      const a = (await actors())[bi],
        actor = a.workers[li],
        peer = a.workers[(li + 1) % 4],
        c = workforceOperationsCopy[locale],
        w = workforceCopy[locale],
        m = workforceMonthCopy[locale],
        week = weeks[li * 2 + bi]!,
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const monthRequests: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes("/workforce/monthly-statistics?"))
          monthRequests.push(new URL(r.url()).searchParams.get("month") ?? "");
      });

      await page.setViewportSize({ width: 1440, height: 1000 });
      await advance(page, week + "T08:00");
      await login(page, a.manager);
      await open(page, locale, week);
      const source = await page.request.get(
        api + "/v1/staff/workforce?from=" + week + "&to=" + dayAdd(week, 6),
      );
      expect(source.ok()).toBe(true);
      const current = await source.json(),
        schedule = current.schedules.find((s: any) => s.week === week),
        shift = schedule.snapshot.assignments.find(
          (s: any) =>
            s.membershipId === actor.membershipId &&
            s.startsLocal.startsWith(week),
        );
      expect(shift).toBeTruthy();
      await expect(page.locator(".wf-week-grid")).toBeVisible();
      await page.screenshot({
        path: `artifacts/workforce-wf4/week-${a.country}-${locale}.png`,
        fullPage: true,
      });
      await drag(
        page,
        page.getByTestId("shift-" + shift.id).getByRole("button", {
          name: w.move + ": " + actor.displayName,
          exact: true,
        }),
        page.locator(
          `[data-wf-drop-day="${dayAdd(week, 5)}"][data-wf-drop-member="${peer.membershipId}"]`,
        ),
      );
      await expect
        .poll(async () => {
          const r = await page.request.get(
            api + "/v1/staff/workforce?from=" + week + "&to=" + dayAdd(week, 6),
          );
          return (await r.json()).schedules
            .find((s: any) => s.week === week)
            .snapshot.assignments.find((s: any) => s.id === shift.id)
            .membershipId;
        })
        .toBe(peer.membershipId);
      await page.getByRole("button", { name: w.day, exact: true }).click();
      await expect(page.locator(".wf-day")).toBeVisible();
      await page.getByLabel(w.date, { exact: true }).fill(dayAdd(week, 2));
      await page.screenshot({
        path: `artifacts/workforce-wf4/day-${a.country}-${locale}.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: w.month, exact: true }).click();
      await expect(page.locator(".wf-month-summary")).toBeVisible();
      await page.getByLabel(w.compact, { exact: true }).selectOption("compact");
      await page.screenshot({
        path: `artifacts/workforce-wf4/compact-${a.country}-${locale}.png`,
        fullPage: true,
      });
      await page
        .getByLabel(w.compact, { exact: true })
        .selectOption("comfortable");
      await page.getByRole("button", { name: w.week, exact: true }).click();
      await page.getByRole("button", { name: w.review, exact: true }).click();
      await page.getByLabel(w.confirmed, { exact: true }).check();
      await page
        .locator(".wf-review")
        .getByRole("button", { name: w.republish, exact: true })
        .click();
      await expect(page.getByRole("status")).toHaveText(w.publishedSuccess);
      const context = await browser.newContext({
          viewport: { width: 390, height: 1000 },
          hasTouch: true,
          isMobile: true,
        }),
        employee = await context.newPage();
      employee.on("pageerror", (e) => errors.push(e.message));
      await login(employee, actor);
      const date = dayAdd(week, 2);
      await advance(page, date + "T09:00");
      await open(employee, locale, date, "today");
      const panel = employee.getByTestId("wf2-workspace");
      await uiPunch(
        employee,
        panel.getByRole("button", { name: c.clockIn, exact: true }),
        date + "T09:00",
        true,
      );
      await expect(
        panel.getByRole("button", { name: c.startBreak, exact: true }),
      ).toBeVisible();
      await advance(page, date + "T12:00");
      await refresh(employee, c);
      await uiPunch(
        employee,
        panel.getByRole("button", { name: c.startBreak, exact: true }),
        date + "T12:00",
      );
      await expect(
        panel.getByRole("button", { name: c.endBreak, exact: true }),
      ).toBeVisible();
      await advance(page, date + "T12:30");
      await refresh(employee, c);
      await uiPunch(
        employee,
        panel.getByRole("button", { name: c.endBreak, exact: true }),
        date + "T12:30",
      );
      await advance(page, date + "T17:00");
      await refresh(employee, c);
      await uiPunch(
        employee,
        panel.getByRole("button", { name: c.clockOut, exact: true }),
        date + "T17:00",
      );
      await expect(
        panel.getByRole("button", { name: c.clockIn, exact: true }),
      ).toBeVisible();
      const own = await employee.request.get(
          api +
            "/v1/staff/workforce/operations?from=" +
            week +
            "&to=" +
            dayAdd(week, 6),
        ),
        data = await own.json(),
        attendance = data.attendance.find(
          (x: any) => x.userId === actor.userId,
        );
      expect(data.roster).toHaveLength(1);
      expect(data.attendance.every((x: any) => x.userId === actor.userId)).toBe(
        true,
      );
      expect(attendance.totals.workedMs).toBe(450 * 60000);
      await refresh(page, c);
      await approve(
        page,
        c,
        page
          .locator(`[data-workforce-attendance="${attendance.id}"]`)
          .getByRole("button", { name: c.reviewHours, exact: true }),
      );
      await refresh(employee, c);
      await panel.getByRole("tab", { name: c.hours, exact: true }).tap();
      await expect(panel.locator(".wf2-list")).toContainText(c.approved);
      await panel.getByRole("tab", { name: c.leave, exact: true }).tap();
      const form = panel.locator("form").filter({
        has: employee.getByRole("heading", {
          name: c.requestLeave,
          exact: true,
        }),
      });
      await form.getByLabel(c.from, { exact: true }).fill(dayAdd(date, 1));
      await form.getByLabel(c.to, { exact: true }).fill(dayAdd(date, 1));
      await form.getByRole("button", { name: c.submit, exact: true }).tap();
      await refresh(page, c);
      const leave = page
        .getByTestId("wf2-workspace")
        .locator(".wf2-card")
        .filter({
          has: page.getByRole("heading", { name: c.annual, exact: true }),
        });
      await approve(
        page,
        c,
        leave.getByRole("button", { name: c.review, exact: true }),
      );
      await panel.getByRole("tab", { name: c.requests, exact: true }).tap();
      await expect(panel.locator("form")).toBeVisible();
      const statistics = page.waitForResponse((r) =>
        r.url().includes("/workforce/monthly-statistics?month=2031-03"),
      );
      await page.getByRole("tab", { name: m.monthTab, exact: true }).click();
      const month = page.getByTestId("wf3-month");
      const statsResponse = await statistics;
      expect(statsResponse.ok(), await statsResponse.text()).toBe(true);
      expect(
        (await statsResponse.json()).team.some(
          (row: any) => row.employee.membershipId === actor.membershipId,
        ),
      ).toBe(true);
      expect(monthRequests.every((month) => month === "2031-03")).toBe(true);

      await month
        .getByLabel(m.employee, { exact: true })
        .selectOption(actor.membershipId);
      await expect(month.getByTestId("wf3-provisional-note")).toHaveText(
        m.provisionalNote,
      );
      const manifest = JSON.parse(
          await readFile("artifacts/workforce-wf4/manifest.json", "utf8"),
        ),
        expected = manifest.businesses[bi].workers[li].expected;
      const before = await page.request.get(
        api +
          "/v1/staff/workforce/monthly-account?month=2031-03&membershipId=" +
          actor.membershipId,
      );
      expect((await before.json()).account.totals).toEqual(expected);
      await month
        .getByRole("button", { name: m.closeMonth, exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByLabel(m.reason, { exact: true })
        .fill("Verified independent full-month ledger and approved sources");
      await dialog.getByLabel(m.confirm, { exact: true }).check();
      await dialog
        .getByRole("button", { name: m.closeMonth, exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      await expect(month.getByTestId("wf3-close-version")).toContainText(
        m.originalClose,
      );
      for (const width of [360, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.screenshot({
          path: `artifacts/workforce-wf4/manager-${a.country}-${locale}-${width}.png`,
          fullPage: true,
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
      }
      for (const format of ["csv", "pdf"] as const) {
        const download = page.waitForEvent("download");
        await month
          .getByRole("button", {
            name: format === "csv" ? m.csv : m.pdf,
            exact: true,
          })
          .click();
        await (
          await download
        ).saveAs(
          `artifacts/workforce-wf4/browser-${a.country}-${locale}.${format}`,
        );
      }
      await panel.getByRole("tab", { name: m.monthTab, exact: true }).tap();
      await expect(
        employee.getByTestId("wf3-month").locator(".wf3-status"),
      ).toContainText(m.closed);
      for (const width of [360, 390, 768, 1440]) {
        await employee.setViewportSize({ width, height: 1000 });
        await employee.screenshot({
          path: `artifacts/workforce-wf4/employee-${a.country}-${locale}-${width}.png`,
          fullPage: true,
        });
        expect(
          await employee.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
      }
      await panel.getByRole("tab", { name: m.inbox, exact: true }).tap();
      const inbox = employee.getByTestId("wf3-inbox");
      await expect(inbox.locator(".wf3-notice").first()).toBeVisible();
      const notice = inbox
        .locator(".wf3-notice")
        .filter({
          has: employee.getByRole("button", { name: m.ack, exact: true }),
        })
        .first();
      const read = notice.getByRole("button", { name: m.read, exact: true });
      if (await read.count()) await read.tap();
      await notice.getByRole("button", { name: m.ack, exact: true }).tap();
      const ack = employee.getByRole("dialog");
      await ack.getByLabel(m.ackHelp, { exact: true }).check();
      await ack.getByRole("button", { name: m.ack, exact: true }).tap();
      await expect(ack).not.toBeVisible();
      expect(errors).toEqual([]);
      await writeFile(
        `artifacts/workforce-wf4/browser-${a.country}-${locale}.json`,
        JSON.stringify(
          {
            status: "passed",
            country: a.country,
            locale,
            widths: [360, 390, 768, 1440],
            monthlyTotals: expected,
            clockAttendanceId: attendance.id,
            touch: true,
            keyboard: true,
            dragAndDrop: true,
          },
          null,
          2,
        ),
      );
      await context.close();
    });
test("final shared month manifest has every independent close and no discrepancies", async ({
  request,
}) => {
  const r = await request.post(api + "/__fixture/workforce-wf4/finalize");
  expect(r.ok(), await r.text()).toBe(true);
  expect(await r.json()).toEqual({ status: "passed", closes: 22 });
});
