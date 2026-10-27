import { test, expect, type Page, type Browser } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { workforceMonthCopy } from "../../apps/web/components/workforce/month-copy";
const api = "http://localhost:4405",
  actors = async (locale: string) =>
    JSON.parse(await readFile("artifacts/workforce-wf3/actors.json", "utf8"))[
      locale
    ];
async function login(page: Page, actor: any) {
  const r = await page.request.post(api + "/v1/auth/login", {
    data: {
      tenantSlug: actor.tenantSlug,
      venueSlug: actor.venueSlug,
      email: actor.email,
      password: actor.password,
    },
  });
  expect(r.ok(), await r.text()).toBe(true);
}
async function open(page: Page, locale: string, tab = "month") {
  await page.goto(
    "/" +
      locale +
      "/staff/schedule?date=2030-08-12&workforceTab=" +
      tab +
      "&workforceMonth=2030-08",
  );
  await expect(
    page.getByTestId(tab === "month" ? "wf3-month" : "wf3-inbox"),
  ).toBeVisible({ timeout: 60000 });
}
async function account(page: Page, id?: string) {
  const r = await page.request.get(
    api +
      "/v1/staff/workforce/monthly-account?month=2030-08" +
      (id ? "&membershipId=" + id : ""),
  );
  expect(r.ok(), await r.text()).toBe(true);
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
for (const locale of ["sq", "de", "en", "it"] as const)
  test(
    locale +
      ": complete monthly sources, independent close, compensation, inbox and exports",
    async ({ page, browser }) => {
      const a = await actors(locale),
        c = workforceMonthCopy[locale],
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await login(page, a.worker);
      await open(page, locale);
      const panel = page.getByTestId("wf3-month");
      await expect(panel.getByTestId("wf3-approvedMs")).toContainText(
        new Intl.NumberFormat(locale === "sq" ? "de" : locale, {
          maximumFractionDigits: 2,
          useGrouping: false,
        }).format(7.5),
      );
      await expect(panel).not.toContainText("Synthetic Crew B");
      await expect(panel.locator(".wf3-status")).toContainText(c.draft);
      await expect(panel.getByTestId("wf3-provisional-note")).toHaveText(
        c.provisionalNote,
      );
      await expect(panel.getByTestId("wf3-targetMs")).toContainText(c.target);
      await expect(panel.getByTestId("wf3-actualMs")).toContainText(
        c.recordedToDate,
      );
      expect((await account(page)).account.totals.approvedMs).toBe(450 * 60000);
      for (const width of [360, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.screenshot({
          path: `artifacts/workforce-wf3/employee-${locale}-${width}.png`,
          fullPage: true,
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        ).toBe(true);
      }
      const csvDownload = page.waitForEvent("download");
      await panel.getByRole("button", { name: c.csv, exact: true }).click();
      const csv = await csvDownload;
      expect(csv.suggestedFilename()).toBe("workforce-2030-08.csv");
      await csv.saveAs(`artifacts/workforce-wf3/month-${locale}.csv`);
      expect(
        await readFile(`artifacts/workforce-wf3/month-${locale}.csv`, "utf8"),
      ).toContain(c.provisionalNote);
      const pdfDownload = page.waitForEvent("download");
      await panel.getByRole("button", { name: c.pdf, exact: true }).click();
      const pdf = await pdfDownload;
      await pdf.saveAs(`artifacts/workforce-wf3/month-${locale}.pdf`);
      await panel
        .getByRole("button", { name: c.printable, exact: true })
        .click();
      await expect(page.getByTestId("wf3-print-report")).toContainText(c.title);
      await expect(page.getByTestId("wf3-print-report")).toContainText(
        c.provisionalNote,
      );
      await page.emulateMedia({ media: "print" });
      await page.screenshot({
        path: `artifacts/workforce-wf3/print-${locale}.png`,
        fullPage: true,
      });
      await page.emulateMedia({ media: "screen" });
      await page
        .getByRole("dialog")
        .getByRole("button", { name: c.closeDialog, exact: true })
        .click();
      const lead = await managerPage(browser, a.manager, locale),
        manager = lead.page.getByTestId("wf3-month");
      await manager
        .getByLabel(c.employee, { exact: true })
        .selectOption(a.worker.membershipId);
      await expect(manager.getByTestId("wf3-approvedMs")).toContainText(
        new Intl.NumberFormat(locale === "sq" ? "de" : locale, {
          maximumFractionDigits: 2,
          useGrouping: false,
        }).format(7.5),
      );
      await lead.page.screenshot({
        path: `artifacts/workforce-wf3/manager-${locale}.png`,
        fullPage: true,
      });
      await manager
        .getByRole("button", { name: c.closeMonth, exact: true })
        .click();
      const dialog = lead.page.getByRole("dialog");
      await dialog
        .getByLabel(c.reason, { exact: true })
        .fill("Reviewed complete synthetic monthly sources");
      await dialog.getByLabel(c.confirm, { exact: true }).check();
      await dialog
        .getByRole("button", { name: c.closeMonth, exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      const closed = await account(lead.page, a.worker.membershipId);
      expect(closed.closing.version).toBe(1);
      await expect(manager.getByTestId("wf3-provisional-note")).toHaveCount(0);
      await expect(manager.getByTestId("wf3-close-version")).toContainText(
        c.originalClose + " · V1",
      );
      expect(closed.account.totals.creditedMs).toBe(960 * 60000);
      const request = await page.request.post(
        api + "/v1/staff/workforce/corrections",
        {
          data: {
            idempotencyKey: crypto.randomUUID(),
            attendanceId: a.attendanceId,
            expectedAttendanceVersion: 4,
            reason: "INTERVAL",
            startsLocal: "2030-08-12T09:00",
            endsLocal: "2030-08-12T17:30",
            startChoice: "reject",
            endChoice: "reject",
            breaks: [
              {
                startsLocal: "2030-08-12T12:00",
                endsLocal: "2030-08-12T12:30",
                startChoice: "reject",
                endChoice: "reject",
                kind: "UNPAID",
              },
            ],
          },
        },
      );
      expect(request.ok(), await request.text()).toBe(true);
      const correction = await request.json();
      const decision = await lead.page.request.post(
        api + "/v1/staff/workforce/requests/" + correction.id + "/decision",
        {
          data: {
            expectedVersion: 0,
            action: "APPROVE",
            reason: "Reviewed original and proposed synthetic work",
            reviewConfirmed: true,
            warningsAcknowledged: true,
          },
        },
      );
      expect(decision.ok(), await decision.text()).toBe(true);
      await panel.getByRole("button", { name: c.refresh, exact: true }).click();
      await expect(panel.getByTestId("wf3-approvedMs")).toContainText("8 h");
      await expect(panel).toContainText(c.adjustments);
      const adjusted = await account(page);
      expect(adjusted.closing.original).toEqual(closed.closing.original);
      expect(adjusted.adjustments).toHaveLength(1);
      await expect(panel.getByTestId("wf3-close-version")).toContainText(
        c.latestCompensation + " · V1",
      );
      await panel.getByLabel(c.original, { exact: true }).check();
      await expect(panel.getByTestId("wf3-close-version")).not.toContainText(
        c.latestCompensation,
      );
      await expect(panel.getByTestId("wf3-approvedMs")).toContainText(
        new Intl.NumberFormat(locale === "sq" ? "de" : locale, {
          maximumFractionDigits: 2,
        }).format(7.5),
      );
      await panel.getByLabel(c.original, { exact: true }).uncheck();
      await page.getByRole("tab", { name: c.inbox, exact: true }).click();
      const inbox = page.getByTestId("wf3-inbox");
      await expect(inbox.locator(".wf3-notice").first()).toBeVisible();
      const important = inbox
        .locator(".wf3-notice")
        .filter({ has: page.getByRole("button", { name: c.ack, exact: true }) })
        .first();
      await important
        .getByRole("button", { name: c.read, exact: true })
        .click();
      await expect(
        important.getByRole("button", { name: c.read, exact: true }),
      ).toHaveCount(0);
      await important.getByRole("button", { name: c.ack, exact: true }).click();
      const ack = page.getByRole("dialog");
      await ack.getByLabel(c.ackHelp, { exact: true }).check();
      await ack.getByRole("button", { name: c.ack, exact: true }).click();
      await expect(ack).not.toBeVisible();
      await inbox
        .getByRole("button", { name: c.preferences, exact: true })
        .click();
      const prefs = page.getByRole("dialog");
      await prefs.getByLabel(c.email, { exact: true }).check();
      await prefs.getByLabel(c.consent, { exact: true }).check();
      await prefs.getByRole("button", { name: c.saved, exact: true }).click();
      await expect(prefs).not.toBeVisible();
      await expect(inbox).toContainText(c.providerDisabled);
      await page.screenshot({
        path: `artifacts/workforce-wf3/inbox-${locale}.png`,
        fullPage: true,
      });
      const ownInbox = await page.request.get(
        api + "/v1/staff/workforce/notifications?locale=" + locale,
      );
      expect((await ownInbox.json()).preferences.emailEnabled).toBe(true);
      expect(errors).toEqual([]);
      await lead.context.close();
    },
  );
test("AL employment uses its confirmed rules even in a German interface; touch and keyboard operate the same sources", async ({
  browser,
}) => {
  const a = await actors("sq"),
    c = workforceMonthCopy.de,
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    }),
    page = await context.newPage();
  await login(page, a.worker);
  await open(page, "de");
  const panel = page.getByTestId("wf3-month");
  const accountData = await account(page);
  expect(
    accountData.account.targetDays.some(
      (d: { countryCode: string }) => d.countryCode === "AL",
    ),
  ).toBe(true);
  await panel.getByRole("button", { name: c.printable, exact: true }).tap();
  await expect(page.getByTestId("wf3-print-report")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("tab", { name: c.inbox, exact: true }).tap();
  await expect(page.getByTestId("wf3-inbox")).toBeVisible();
  await context.close();
});
test("two reviewers conflict safely and a lost close response retries the same immutable request", async ({
  browser,
}) => {
  const a = await actors("en"),
    c = workforceMonthCopy.en,
    first = await managerPage(browser, a.manager, "en"),
    second = await managerPage(browser, a.owner, "en");
  for (const lead of [first, second])
    await lead.page
      .getByTestId("wf3-month")
      .getByLabel(c.employee, { exact: true })
      .selectOption(a.peer.membershipId);
  for (const lead of [first, second]) {
    await lead.page
      .getByTestId("wf3-month")
      .getByRole("button", { name: c.closeMonth, exact: true })
      .click();
    const d = lead.page.getByRole("dialog");
    await d
      .getByLabel(c.reason, { exact: true })
      .fill("Independent synthetic empty-month review");
    await d.getByLabel(c.confirm, { exact: true }).check();
  }
  let intercepted = false;
  await first.page.route("**/monthly-account/*/close?*", async (route) => {
    if (!intercepted) {
      intercepted = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await first.page
    .getByRole("dialog")
    .getByRole("button", { name: c.closeMonth, exact: true })
    .click();
  await expect(first.page.getByTestId("wf3-month")).toContainText(c.error);
  await first.page.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(first.page.getByRole("dialog")).not.toBeVisible();
  const closed = await account(first.page, a.peer.membershipId);
  expect(closed.closing.version).toBe(1);
  await second.page
    .getByRole("dialog")
    .getByRole("button", { name: c.closeMonth, exact: true })
    .click();
  await expect(second.page.getByRole("dialog")).toContainText(c.conflict);
  await first.context.close();
  await second.context.close();
});
