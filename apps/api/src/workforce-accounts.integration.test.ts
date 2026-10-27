import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { buildApp } from "./app.js";
import {
  prisma,
  workforceNotificationOutbox,
  enqueueDueWorkforceReminders,
  workforceUnreadCountQuery,
} from "@flowgastronomie/database";
import {
  workforceDefaultRules,
  workforceNotificationCategories,
  type WorkforceAccountRules,
} from "@flowgastronomie/domain";
import { workforceFixture } from "../../../tests/workforce/fixtures.js";
import { createWorkforceNotificationWorker } from "./workforce-notification-worker.js";
import { disabledTransactionalNotificationService } from "./transactional-notifications.js";
let now = new Date("2030-08-12T07:00Z");
const app = buildApp({}, { workforceClock: () => new Date(now) }),
  prefix = "/v1/staff/workforce/",
  key = () => randomUUID();
const send = (
  cookie: string,
  path: string,
  payload?: unknown,
  method = payload ? "POST" : "GET",
) =>
  app.inject({
    method: method as "GET" | "POST" | "PUT" | "PATCH",
    url: prefix + path,
    headers: { cookie },
    ...(payload ? { payload: payload as object } : {}),
  });
let de: Awaited<ReturnType<typeof workforceFixture>>, al: typeof de;
type Employee = Awaited<ReturnType<typeof de.addEmployee>>;
let worker: Employee, peer: Employee, manager: Employee, complete: Employee;
let id: string;
const rules: WorkforceAccountRules = {
  timezone: "Europe/Berlin",
  workingWeekdays: [1, 2, 3, 4, 5],
  targetBasis: "WEEKLY_WORKDAYS",
  plannedBreakTreatment: "UNPAID",
  plannedBreakAllocation: "PROPORTIONAL",
  paidLeaveCategories: ["ANNUAL"],
  holidays: [{ date: "2030-08-19", label: "Confirmed synthetic holiday" }],
  creditOverlapRule: "LIMIT_TO_TARGET",
  overtimeBasis: "APPROVED_OVER_TARGET",
  carryoverMode: "BALANCE",
  carryPositiveLimitMinutes: null,
  carryNegativeLimitMinutes: null,
  openingMonth: "2030-08",
  openingBalanceMinutes: 0,
  retentionYears: 2,
  legalReviewConfirmed: true,
};
const month = async (
  cookie: string,
  employee = worker.membershipId,
  period = "2030-08",
) => {
  const r = await send(
    cookie,
    "monthly-account?month=" + period + "&membershipId=" + employee,
  );
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
};
const inbox = async (cookie: string, lang = "en") => {
  const r = await send(cookie, "notifications?locale=" + lang);
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
};
const punch = (cookie: string, kind: string, version: number, extra = {}) =>
  send(cookie, "attendance/punch", {
    kind,
    expectedVersion: version,
    idempotencyKey: key(),
    ...extra,
  });
const decision = (
  cookie: string,
  id: string,
  action = "APPROVE",
  version = 0,
) =>
  send(cookie, "requests/" + id + "/decision", {
    expectedVersion: version,
    action,
    reason: "Synthetic independent operational decision",
    reviewConfirmed: true,
    warningsAcknowledged: true,
  });
const close = (
  cookie: string,
  member: string,
  period: string,
  fingerprint: string,
  k = key(),
) =>
  send(cookie, "monthly-account/" + member + "/close?month=" + period, {
    idempotencyKey: k,
    expectedFingerprint: fingerprint,
    reason: "Synthetic full monthly review",
    reviewConfirmed: true,
  });
async function configure(e: Employee) {
  let r = await send(
    de.owner.cookie,
    "profiles/" + e.membershipId,
    {
      expectedVersion: 0,
      employmentStartedOn: "2026-01-01",
      stations: ["KITCHEN"],
      skills: ["Food safety"],
    },
    "PUT",
  );
  expect(r.statusCode, r.body).toBe(200);
  r = await send(de.owner.cookie, "profiles/" + e.membershipId + "/contracts", {
    expectedVersion: 1,
    effectiveFrom: "2026-01-01",
    employmentType: "FULL_TIME",
    weeklyTargetMinutes: 2400,
    monthlyTargetMinutes: null,
    countryCode: "DE",
    terms: "CONFIDENTIAL HR TERMS DO NOT EXPORT",
  });
  expect(r.statusCode, r.body).toBe(200);
}
async function preference(
  cookie: string,
  email = true,
  push = false,
  expectedVersion = 0,
  lang = "en",
) {
  const r = await send(
    cookie,
    "notification-preferences",
    {
      expectedVersion,
      locale: lang,
      emailEnabled: email,
      pushEnabled: push,
      reminderMinutes: 60,
      categories: [...workforceNotificationCategories],
      consentConfirmed: true,
    },
    "PUT",
  );
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
describe
  .skipIf(process.env.WORKFORCE_WF3_DB_GATE !== "true")
  .sequential("WF3 canonical PostgreSQL + API acceptance", () => {
    beforeAll(async () => {
      const u = new URL(process.env.DATABASE_URL!);
      if (!/^workforce_wf3_gate_\d+$/.test(u.searchParams.get("schema") ?? ""))
        throw new Error("Isolated local WF3 schema required");
      de = await workforceFixture(app, "DE");
      al = await workforceFixture(app, "AL");
      worker = await de.addEmployee("Synthetic Monthly Worker");
      peer = await de.addEmployee("Synthetic Private Coworker");
      manager = await de.addEmployee("Synthetic Monthly Manager", "MANAGER");
      for (const e of [worker, peer, manager]) await configure(e);
      let r = await send(de.owner.cookie, "policy", {
        expectedVersion: 0,
        effectiveFrom: "2026-01-01",
        countryCode: "DE",
        rules: {
          ...workforceDefaultRules("DE"),
          paidBreaksAllowed: true,
          excludedLeaveDates: ["2030-08-19"],
        },
        reason: "Synthetic legal and contract policy review",
      });
      expect(r.statusCode, r.body).toBe(200);
      r = await send(de.owner.cookie, "account-policies", {
        expectedVersion: 0,
        effectiveFrom: "2026-01-01",
        countryCode: "DE",
        rules,
        reason: "Synthetic calendar/target/carry review",
        reviewConfirmed: true,
      });
      expect(r.statusCode, r.body).toBe(200);
      await preference(worker.cookie);
      await preference(manager.cookie);
      const rshift = await send(
        de.owner.cookie,
        "schedule",
        {
          week: "2030-08-12",
          expectedVersion: 0,
          status: "PUBLISHED",
          reviewConfirmed: true,
          assignments: [
            {
              id: key(),
              membershipId: worker.membershipId,
              station: "KITCHEN",
              startsLocal: "2030-08-12T09:00",
              endsLocal: "2030-08-12T17:00",
              startChoice: "reject",
              endChoice: "reject",
              breakMinutes: 30,
              requiredSkills: ["Food safety"],
              note: "Synthetic published shift",
            },
            {
              id: key(),
              membershipId: peer.membershipId,
              station: "KITCHEN",
              startsLocal: "2030-08-13T09:00",
              endsLocal: "2030-08-13T17:00",
              startChoice: "reject",
              endChoice: "reject",
              breakMinutes: 30,
              requiredSkills: ["Food safety"],
              note: "Synthetic private shift",
            },
          ],
        },
        "PUT",
      );
      expect(rshift.statusCode, rshift.body).toBe(200);
    }, 60000);
    afterAll(async () => {
      await app.close();
      await prisma.$disconnect();
    });
    it("employee monthly JSON is self-only and exposes provenance without HR/contracts or coworker records", async () => {
      const a = await month(worker.cookie);
      expect(a.employee.userId).toBe(worker.userId);
      expect(JSON.stringify(a)).not.toContain(peer.userId);
      expect(JSON.stringify(a)).not.toContain("CONFIDENTIAL HR TERMS");
      expect(a.account.totals.targetMs).toBe(22 * 480 * 60000);
      expect(a.account.totals.plannedMs).toBe(450 * 60000);
      expect(
        (
          await send(
            worker.cookie,
            "monthly-account?month=2030-08&membershipId=" + peer.membershipId,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await send(
            al.owner.cookie,
            "monthly-account?month=2030-08&membershipId=" + worker.membershipId,
          )
        ).statusCode,
      ).toBe(404);
      const m = await month(manager.cookie);
      expect(JSON.stringify(m)).not.toContain("CONFIDENTIAL HR TERMS");
      expect(
        (
          await send(manager.cookie, "account-policies", {
            expectedVersion: 1,
            effectiveFrom: "2030-09-01",
            countryCode: "DE",
            rules,
            reason: "Not authorized",
            reviewConfirmed: true,
          })
        ).statusCode,
      ).toBe(403);
    });
    it("publishing persists only the worker's relevant notification and disabled provider is never DELIVERED", async () => {
      const a = await inbox(worker.cookie);
      expect(
        a.items.some(
          (n: { category: string }) => n.category === "SCHEDULE_PUBLISHED",
        ),
      ).toBe(true);
      expect(JSON.stringify(a)).not.toContain(peer.userId);
      expect(JSON.stringify(a)).not.toContain("recipientAddress");
      const w = createWorkforceNotificationWorker({
        emailService: disabledTransactionalNotificationService,
        emailProvider: "brevo",
        clock: () => new Date(now),
      });
      await w.runOnce();
      const d = await prisma.workforceNotificationDelivery.findMany({
        where: { userId: worker.userId, channel: "EMAIL" },
      });
      expect(
        d.every(
          (x) => x.state === "DISABLED" && x.lastCode === "PROVIDER_DISABLED",
        ),
      ).toBe(true);
      expect(d.every((x) => x.deliveredAt === null)).toBe(true);
    });
    it("clock/break/approval reconciles exact monthly amounts and independent approvals", async () => {
      let r = await punch(worker.cookie, "CLOCK_IN", 0);
      expect(r.statusCode, r.body).toBe(200);
      id = r.json().attendanceId;
      now = new Date("2030-08-12T10:00Z");
      expect(
        (await punch(worker.cookie, "BREAK_START", 1, { breakKind: "UNPAID" }))
          .statusCode,
      ).toBe(200);
      now = new Date("2030-08-12T10:30Z");
      expect((await punch(worker.cookie, "BREAK_END", 2)).statusCode).toBe(200);
      now = new Date("2030-08-12T15:00Z");
      expect((await punch(worker.cookie, "CLOCK_OUT", 3)).statusCode).toBe(200);
      let a = await month(worker.cookie);
      expect(a.account.totals.actualMs).toBe(450 * 60000);
      expect(a.account.totals.approvedMs).toBe(0);
      expect(a.account.warnings).toContain("UNAPPROVED_ATTENDANCE");
      r = await send(manager.cookie, "attendance/" + id + "/approval", {
        expectedVersion: 4,
        reason: "Verified synthetic actual work",
        reviewConfirmed: true,
        warningsAcknowledged: true,
      });
      expect(r.statusCode, r.body).toBe(200);
      a = await month(worker.cookie);
      expect(a.account.totals.approvedMs).toBe(450 * 60000);
      expect(a.account.totals.actualUnpaidBreakMs).toBe(30 * 60000);
      expect(
        a.account.entries.find(
          (e: { category: string }) => e.category === "APPROVED",
        ).scheduleRevisionId,
      ).toBeTruthy();
    });
    it("leaves/confirmed holiday credits preserve decisions and no wage cost is invented", async () => {
      let r = await send(de.owner.cookie, "leave-allowance", {
        membershipId: worker.membershipId,
        year: 2030,
        minutes: 4800,
        expectedVersion: 0,
        reason: "Explicit synthetic opening allowance",
        idempotencyKey: key(),
      });
      expect(r.statusCode, r.body).toBe(200);
      r = await send(worker.cookie, "leave", {
        idempotencyKey: key(),
        category: "ANNUAL",
        from: "2030-08-14",
        to: "2030-08-14",
        partial: null,
      });
      expect(r.statusCode, r.body).toBe(200);
      expect((await decision(manager.cookie, r.json().id)).statusCode).toBe(
        200,
      );
      const a = await month(worker.cookie);
      expect(a.account.totals.creditedMs).toBe(960 * 60000);
      expect(
        a.account.entries.some(
          (e: { sourceKind: string; leaveDecisionId?: string }) =>
            e.sourceKind === "APPROVED_LEAVE" && !!e.leaveDecisionId,
        ),
      ).toBe(true);
      const stats = await send(
        manager.cookie,
        "monthly-statistics?month=2030-08",
      );
      expect(stats.statusCode, stats.body).toBe(200);
      expect(stats.json()).not.toHaveProperty("laborToSales");
      expect(stats.json().trends).toHaveLength(3);
      const owner = await send(
        de.owner.cookie,
        "monthly-statistics?month=2030-08",
      );
      expect(owner.json().laborToSales.status).toBe("NOT_CONFIGURED");
      expect(
        (await send(worker.cookie, "monthly-statistics?month=2030-08"))
          .statusCode,
      ).toBe(403);
    });
    it("closes an ended month once, freezes original sources and rejects stale/self/employee closes", async () => {
      const a = await month(manager.cookie);
      expect(
        (
          await close(
            manager.cookie,
            worker.membershipId,
            "2030-08",
            a.fingerprint,
          )
        ).statusCode,
      ).toBe(400);
      now = new Date("2030-09-02T08:00Z");
      expect(
        (
          await close(
            worker.cookie,
            worker.membershipId,
            "2030-08",
            a.fingerprint,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await close(
            manager.cookie,
            worker.membershipId,
            "2030-08",
            "a".repeat(64),
          )
        ).statusCode,
      ).toBe(409);
      const k = key(),
        r = await close(
          manager.cookie,
          worker.membershipId,
          "2030-08",
          a.fingerprint,
          k,
        );
      expect(r.statusCode, r.body).toBe(200);
      const original = JSON.stringify(r.json().closing.original);
      expect(
        (
          await close(
            manager.cookie,
            worker.membershipId,
            "2030-08",
            a.fingerprint,
            k,
          )
        ).json().closing.original,
      ).toEqual(JSON.parse(original));
      expect(
        (
          await close(
            de.owner.cookie,
            worker.membershipId,
            "2030-08",
            a.fingerprint,
          )
        ).statusCode,
      ).toBe(409);
      const row = await prisma.workforceMonthlyClose.findFirstOrThrow({
        where: { userId: worker.userId },
      });
      await expect(
        prisma.workforceMonthlyClose.update({
          where: { id: row.id },
          data: { reason: "Overwrite" },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.workforceMonthlyClose.delete({ where: { id: row.id } }),
      ).rejects.toThrow();
    });
    it("post-close approved correction appends compensation and retains the original statement", async () => {
      const before = await month(worker.cookie),
        r = await send(worker.cookie, "corrections", {
          idempotencyKey: key(),
          attendanceId: id,
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
        });
      expect(r.statusCode, r.body).toBe(200);
      const d = await decision(manager.cookie, r.json().id);
      expect(d.statusCode, d.body).toBe(200);
      const a = await month(worker.cookie);
      expect(a.closing.original).toEqual(before.closing.original);
      expect(a.account.totals.approvedMs).toBe(480 * 60000);
      expect(a.adjustments).toHaveLength(1);
      expect(a.adjustments[0].delta.approvedMs).toBe(30 * 60000);
      expect(a.adjustments[0].auditEventId).toBeTruthy();
      expect((await decision(manager.cookie, r.json().id)).statusCode).toBe(
        409,
      );
      expect((await month(worker.cookie)).adjustments).toHaveLength(1);
    });
    it("inbox read/ack is personal, idempotent and supports all four localized views", async () => {
      for (const lang of ["sq", "de", "en", "it"])
        expect(
          (await inbox(worker.cookie, lang)).items.every(
            (n: { title: string }) => !!n.title,
          ),
        ).toBe(true);
      const a = await inbox(worker.cookie),
        notice = a.items.find((n: { important: boolean }) => n.important);
      expect(notice).toBeTruthy();
      expect(
        (await send(peer.cookie, "notifications/" + notice.id + "/read", {}))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await send(
            al.owner.cookie,
            "notifications/" + notice.id + "/read",
            {},
          )
        ).statusCode,
      ).toBe(404);
      const r = await send(
        worker.cookie,
        "notifications/" + notice.id + "/read",
        {},
      );
      expect(r.statusCode, r.body).toBe(200);
      expect(
        (
          await send(worker.cookie, "notifications/" + notice.id + "/read", {})
        ).json(),
      ).toEqual(r.json());
      expect(
        (
          await send(
            worker.cookie,
            "notifications/" + notice.id + "/acknowledgment",
            { reviewConfirmed: false },
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await send(
            worker.cookie,
            "notifications/" + notice.id + "/acknowledgment",
            { reviewConfirmed: true },
          )
        ).statusCode,
      ).toBe(200);
    });
    it("exports are scoped, complete, injection-safe and include immutable original versions", async () => {
      let r = await send(
        worker.cookie,
        "monthly-account/export?month=2030-08&membershipId=" +
          peer.membershipId +
          "&format=csv&locale=en",
      );
      expect(r.statusCode).toBe(403);
      r = await send(
        al.owner.cookie,
        "monthly-account/export?month=2030-08&membershipId=" +
          worker.membershipId +
          "&format=pdf&locale=en",
      );
      expect(r.statusCode).toBe(404);
      await prisma.user.update({
        where: { id: worker.userId },
        data: { displayName: "=HYPERLINK(1)" },
      });
      r = await send(
        worker.cookie,
        "monthly-account/export?month=2030-08&format=csv&locale=en",
      );
      expect(r.statusCode, r.body).toBe(200);
      expect(r.body).toContain("'=HYPERLINK(1)");
      expect(r.body).not.toContain("CONFIDENTIAL HR TERMS");
      expect(r.headers["cache-control"]).toBe("private, no-store");
      expect(r.body).toContain("ADJUSTMENT");
      const original = await send(
        worker.cookie,
        "monthly-account/export?month=2030-08&format=csv&locale=en&version=original",
      );
      expect(original.statusCode).toBe(200);
      expect(original.body).not.toContain('"ADJUSTMENT"');
      for (const lang of ["sq", "de", "en", "it"]) {
        const pdf = await send(
          worker.cookie,
          "monthly-account/export?month=2030-08&format=pdf&locale=" + lang,
        );
        expect(pdf.statusCode, pdf.body.slice(0, 200)).toBe(200);
        expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
      }
    });
    it("real complete sources reconcile 251 additional sessions beyond the UI cap", async () => {
      complete = await de.addEmployee("Synthetic 251-record Monthly Worker");
      await configure(complete);
      const start = Date.parse("2030-09-03T07:00Z"),
        ids: string[] = [];
      for (let i = 0; i < 251; i++) {
        now = new Date(start + i * 120000);
        let r = await punch(complete.cookie, "CLOCK_IN", 0);
        expect(r.statusCode, r.body).toBe(200);
        const id = r.json().attendanceId;
        ids.push(id);
        now = new Date(start + i * 120000 + 60000);
        r = await punch(complete.cookie, "CLOCK_OUT", 1);
        expect(r.statusCode, r.body).toBe(200);
        r = await send(manager.cookie, "attendance/" + id + "/approval", {
          expectedVersion: 2,
          reason: "Synthetic complete monthly source review",
          reviewConfirmed: true,
          warningsAcknowledged: true,
        });
        expect(r.statusCode, r.body).toBe(200);
      }
      const a = await month(complete.cookie, complete.membershipId, "2030-09");
      expect(a.account.totals.approvedMs).toBe(251 * 60000);
      expect(
        a.account.entries.filter(
          (e: { category: string }) => e.category === "APPROVED",
        ),
      ).toHaveLength(251);
      expect(
        a.account.entries.filter(
          (e: { category: string }) => e.category === "ACTUAL",
        ),
      ).toHaveLength(251);
      const ui = await send(
        complete.cookie,
        "operations?from=2030-09-01&to=2030-09-30",
      );
      expect(ui.json().attendance).toHaveLength(200);
      expect(ui.json().truncated).toBe(true);
      const source = await send(
        complete.cookie,
        "approved-hours?from=2030-09-01&to=2030-09-30",
      );
      expect(source.json().records).toHaveLength(251);
      expect(source.json().truncated).toBe(false);
      const csv = await send(
        complete.cookie,
        "monthly-account/export?month=2030-09&format=csv&locale=en",
      );
      expect(csv.statusCode, csv.body).toBe(200);
      expect(ids.every((id) => csv.body.includes(id))).toBe(true);
    }, 180000);
    it("two durable workers claim separate deliveries and replay does not duplicate provider delivery", async () => {
      const calls: string[] = [],
        service = {
          async send(
            n: import("./transactional-notifications.js").TransactionalNotification,
          ) {
            expect(n.kind).toBe("WORKFORCE_UPDATE");
            if (n.kind === "WORKFORCE_UPDATE") calls.push(n.notificationId);
          },
        };
      const first = createWorkforceNotificationWorker({
          emailService: service,
          emailProvider: "test",
          clock: () => new Date(now),
        }),
        second = createWorkforceNotificationWorker({
          emailService: service,
          emailProvider: "test",
          clock: () => new Date(now),
        });
      await Promise.all([first.runOnce(500), second.runOnce(500)]);
      expect(calls.length).toBeGreaterThan(0);
      expect(new Set(calls).size).toBe(calls.length);
      const before = await prisma.workforceNotification.count(),
        delivered = await prisma.workforceNotificationDelivery.count({
          where: { state: "DELIVERED" },
        });
      const replay = await workforceNotificationOutbox.replayIntents(manager);
      expect(replay.operationEvents).toBe(
        await prisma.workforceEventIntent.count({
          where: { tenantId: manager.tenantId, venueId: manager.venueId },
        }),
      );
      expect(replay.operationEvents).toBeGreaterThan(750);
      expect(before).toBeGreaterThan(1000);
      expect(await prisma.workforceNotification.count()).toBe(before);
      expect((await first.runOnce(500)).processed).toBe(0);
      expect(
        await prisma.workforceNotificationDelivery.count({
          where: { state: "DELIVERED" },
        }),
      ).toBe(delivered);
    }, 60000);
    it("retry persists failure/backoff, recovers once and retains immutable attempt history", async () => {
      now = new Date("2030-10-01T10:00Z");
      const r = await send(worker.cookie, "leave", {
        idempotencyKey: key(),
        category: "UNPAID",
        from: "2030-10-07",
        to: "2030-10-07",
        partial: null,
      });
      expect(r.statusCode, r.body).toBe(200);
      let failures = 0;
      const failing = createWorkforceNotificationWorker({
        emailService: {
          async send() {
            failures++;
            throw new Error("synthetic private provider response");
          },
        },
        emailProvider: "test",
        clock: () => new Date(now),
      });
      await failing.runOnce(100);
      expect(failures).toBeGreaterThan(0);
      const failed = await prisma.workforceNotificationDelivery.findMany({
        where: { state: "PENDING", lastCode: "DELIVERY_FAILED" },
      });
      expect(failed.length).toBeGreaterThan(0);
      expect(
        failed.every((d) => d.nextAttemptAt.getTime() > now.getTime()),
      ).toBe(true);
      expect((await failing.runOnce()).processed).toBe(0);
      now = new Date(now.getTime() + 31000);
      const calls: string[] = [],
        success = createWorkforceNotificationWorker({
          emailService: {
            async send(n) {
              if (n.kind === "WORKFORCE_UPDATE") calls.push(n.notificationId);
            },
          },
          emailProvider: "test",
          clock: () => new Date(now),
        });
      await success.runOnce(100);
      expect(calls.length).toBe(failed.length);
      for (const row of failed) {
        const attempts =
          await prisma.workforceNotificationDeliveryAttempt.findMany({
            where: { deliveryId: row.id },
            orderBy: { attemptNumber: "asc" },
          });
        expect(attempts.map((a) => a.outcome)).toEqual([
          "FAILURE",
          "DELIVERED",
        ]);
        expect(attempts.map((a) => a.attemptNumber)).toEqual([1, 2]);
        await expect(
          prisma.workforceNotificationDeliveryAttempt.update({
            where: { id: attempts[0]!.id },
            data: { outcome: "DELIVERED" },
          }),
        ).rejects.toThrow();
      }
      expect(JSON.stringify(await inbox(manager.cookie))).not.toContain(
        "synthetic private provider response",
      );
    }, 60000);
    it("inbox pagination is complete beyond 100 rows and cannot use a coworker's cursor", async () => {
      const first = await inbox(complete.cookie);
      expect(first.items).toHaveLength(100);
      expect(first.unreadCount).toBe(502);
      expect(first.nextCursor).toBeTruthy();
      const second = await send(
        complete.cookie,
        "notifications?locale=en&cursor=" + first.nextCursor,
      );
      expect(second.statusCode, second.body).toBe(200);
      expect(second.json().items).toHaveLength(100);
      expect(
        second
          .json()
          .items.every(
            (n: { id: string }) =>
              !first.items.some((a: { id: string }) => a.id === n.id),
          ),
      ).toBe(true);
      expect(
        (
          await send(
            peer.cookie,
            "notifications?locale=en&cursor=" + first.nextCursor,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await send(
            worker.cookie,
            "notification-preferences",
            {
              expectedVersion: 0,
              locale: "en",
              emailEnabled: true,
              pushEnabled: false,
              reminderMinutes: 60,
              categories: [...workforceNotificationCategories],
              consentConfirmed: true,
            },
            "PUT",
          )
        ).statusCode,
      ).toBe(409);
      const pref =
        await prisma.workforceNotificationPreference.findFirstOrThrow({
          where: { userId: worker.userId },
        });
      await expect(
        prisma.workforceNotificationPreference.update({
          where: { id: pref.id },
          data: { version: { increment: 1 }, emailEnabled: false },
        }),
      ).rejects.toThrow();
    });
    it("push consent is personal, rejects SSRF endpoints and keeps payloads private", async () => {
      await preference(worker.cookie, true, true, 1, "de");
      const subscription = {
        endpoint: "https://fcm.googleapis.com/fcm/send/synthetic",
        keys: { p256dh: "b".repeat(87), auth: "a".repeat(22) },
      };
      expect(
        (
          await send(worker.cookie, "push-subscription", {
            consentConfirmed: true,
            subscription: {
              ...subscription,
              endpoint: "http://127.0.0.1/private",
            },
          })
        ).statusCode,
      ).toBe(400);
      const r = await send(worker.cookie, "push-subscription", {
        consentConfirmed: true,
        subscription,
      });
      expect(r.statusCode, r.body).toBe(200);
      const request = await send(worker.cookie, "leave", {
        idempotencyKey: key(),
        category: "UNPAID",
        from: "2030-10-08",
        to: "2030-10-08",
        partial: null,
      });
      expect(request.statusCode).toBe(200);
      expect(
        (await decision(manager.cookie, request.json().id)).statusCode,
      ).toBe(200);
      const pushes: unknown[] = [],
        workerProcess = createWorkforceNotificationWorker({
          emailService: disabledTransactionalNotificationService,
          pushService: {
            provider: "test",
            async send(_claim, payload) {
              pushes.push(payload);
            },
          },
          clock: () => new Date(now),
        });
      await workerProcess.runOnce(100);
      expect(pushes.length).toBeGreaterThan(0);
      expect(JSON.stringify(pushes)).not.toContain("UNPAID");
      expect(JSON.stringify(pushes)).not.toContain("2030-10-08");
      expect(JSON.stringify(pushes)).not.toContain(worker.userId);
      expect(JSON.stringify(pushes)).not.toContain("p256dh");
      expect(JSON.stringify(await inbox(worker.cookie))).not.toContain(
        subscription.keys.p256dh,
      );
    });

    it("carryover compensation propagates through two closed months without changing either original", async () => {
      const carryWorker = await de.addEmployee("Synthetic Carry Chain Worker");
      await configure(carryWorker);
      now = new Date("2030-08-12T07:00Z");
      let r = await punch(carryWorker.cookie, "CLOCK_IN", 0);
      expect(r.statusCode, r.body).toBe(200);
      const attendance = r.json().attendanceId;
      now = new Date("2030-08-12T08:00Z");
      expect((await punch(carryWorker.cookie, "CLOCK_OUT", 1)).statusCode).toBe(
        200,
      );
      expect(
        (
          await send(manager.cookie, "attendance/" + attendance + "/approval", {
            expectedVersion: 2,
            reason: "Reviewed carry source",
            reviewConfirmed: true,
            warningsAcknowledged: true,
          })
        ).statusCode,
      ).toBe(200);
      now = new Date("2030-09-02T08:00Z");
      let a = await month(manager.cookie, carryWorker.membershipId);
      expect(
        (
          await close(
            manager.cookie,
            carryWorker.membershipId,
            "2030-08",
            a.fingerprint,
          )
        ).statusCode,
      ).toBe(200);
      const aug = await month(manager.cookie, carryWorker.membershipId);
      now = new Date("2030-09-03T07:00Z");
      r = await punch(carryWorker.cookie, "CLOCK_IN", 0);
      expect(r.statusCode, r.body).toBe(200);
      const septemberAttendance = r.json().attendanceId;
      now = new Date("2030-09-03T08:00Z");
      expect((await punch(carryWorker.cookie, "CLOCK_OUT", 1)).statusCode).toBe(
        200,
      );
      expect(
        (
          await send(
            manager.cookie,
            "attendance/" + septemberAttendance + "/approval",
            {
              expectedVersion: 2,
              reason: "Reviewed carry source",
              reviewConfirmed: true,
              warningsAcknowledged: true,
            },
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (await month(manager.cookie, carryWorker.membershipId)).adjustments,
      ).toEqual([]);
      now = new Date("2030-10-01T08:00Z");
      a = await month(manager.cookie, carryWorker.membershipId, "2030-09");
      expect(a.account.totals.carryMs).toBe(aug.account.totals.balanceMs);
      const closed = await close(
        manager.cookie,
        carryWorker.membershipId,
        "2030-09",
        a.fingerprint,
      );
      expect(closed.statusCode, closed.body).toBe(200);
      const sep = closed.json();
      r = await send(carryWorker.cookie, "corrections", {
        idempotencyKey: key(),
        attendanceId: attendance,
        expectedAttendanceVersion: 2,
        reason: "INTERVAL",
        startsLocal: "2030-08-12T09:00",
        endsLocal: "2030-08-12T10:30",
        startChoice: "reject",
        endChoice: "reject",
        breaks: [],
      });
      expect(r.statusCode, r.body).toBe(200);
      const approved = await decision(manager.cookie, r.json().id);
      expect(approved.statusCode, approved.body).toBe(200);
      const newAug = await month(carryWorker.cookie, carryWorker.membershipId),
        newSep = await month(
          carryWorker.cookie,
          carryWorker.membershipId,
          "2030-09",
        );
      expect(newAug.closing.original).toEqual(aug.closing.original);
      expect(newSep.closing.original).toEqual(sep.closing.original);
      expect(newAug.account.totals.pendingRequestIds).toBeUndefined();
      expect(newAug.account.pendingRequestIds).toEqual([]);
      expect(newAug.account.warnings).not.toContain("PENDING_REQUESTS");
      expect(newAug.adjustments).toHaveLength(1);
      expect(newSep.adjustments).toHaveLength(1);
      expect(newSep.adjustments[0].delta.carryMs).toBe(30 * 60000);
      expect(newSep.adjustments[0].delta.balanceMs).toBe(30 * 60000);
      expect(newSep.account.carrySourceIds).toContain(newAug.adjustments[0].id);
    }, 60000);
    it("approved leave cancellation after closing compensates credits and restores the canonical leave bank", async () => {
      const before = await month(worker.cookie),
        leave = await prisma.workforceRequest.findFirstOrThrow({
          where: {
            userId: worker.userId,
            kind: "LEAVE",
            status: "APPROVED",
            payload: { path: ["category"], equals: "ANNUAL" },
          },
        });
      const cancelled = await decision(
        manager.cookie,
        leave.id,
        "CANCEL_APPROVED",
        leave.version,
      );
      expect(cancelled.statusCode, cancelled.body).toBe(200);
      const after = await month(worker.cookie);
      expect(after.closing.original).toEqual(before.closing.original);
      expect(after.account.totals.creditedMs).toBe(
        before.account.totals.creditedMs - 480 * 60000,
      );
      expect(after.adjustments.at(-1).delta.creditedMs).toBe(-480 * 60000);
      const bank = await send(
        worker.cookie,
        "leave-allowance/" + worker.membershipId + "?year=2030",
      );
      expect(bank.statusCode, bank.body).toBe(200);
      expect(bank.json().usedMinutes).toBe(0);
    });
    it("confirmed AL rules stay separate from interface language and retain exact 23/25-hour DST sources", async () => {
      const employee = await al.addEmployee("Synthetic AL Time Worker");
      let r = await send(
        al.owner.cookie,
        "profiles/" + employee.membershipId,
        {
          expectedVersion: 0,
          employmentStartedOn: "2026-01-01",
          stations: ["KITCHEN"],
          skills: [],
        },
        "PUT",
      );
      expect(r.statusCode, r.body).toBe(200);
      r = await send(
        al.owner.cookie,
        "profiles/" + employee.membershipId + "/contracts",
        {
          expectedVersion: 1,
          effectiveFrom: "2026-01-01",
          employmentType: "FULL_TIME",
          weeklyTargetMinutes: 2400,
          monthlyTargetMinutes: null,
          countryCode: "AL",
          terms: "Private AL contract",
        },
      );
      expect(r.statusCode, r.body).toBe(200);
      r = await send(al.owner.cookie, "policy", {
        expectedVersion: 0,
        effectiveFrom: "2026-01-01",
        countryCode: "AL",
        rules: workforceDefaultRules("AL"),
        reason: "Reviewed AL operational policy",
      });
      expect(r.statusCode, r.body).toBe(200);
      r = await send(al.owner.cookie, "account-policies", {
        expectedVersion: 0,
        effectiveFrom: "2026-01-01",
        countryCode: "AL",
        rules: {
          ...rules,
          timezone: "Europe/Tirane",
          holidays: [],
          carryoverMode: "NONE",
          openingMonth: null,
        },
        reason: "Reviewed distinct AL account policy",
        reviewConfirmed: true,
      });
      expect(r.statusCode, r.body).toBe(200);
      for (const [start, end, period, hours] of [
        ["2030-03-30T23:00Z", "2030-03-31T22:00Z", "2030-03", 23],
        ["2030-10-26T22:00Z", "2030-10-27T23:00Z", "2030-10", 25],
      ] as const) {
        now = new Date(start);
        r = await punch(employee.cookie, "CLOCK_IN", 0);
        expect(r.statusCode, r.body).toBe(200);
        const id = r.json().attendanceId;
        now = new Date(end);
        expect((await punch(employee.cookie, "CLOCK_OUT", 1)).statusCode).toBe(
          200,
        );
        r = await send(al.owner.cookie, "attendance/" + id + "/approval", {
          expectedVersion: 2,
          reason: "Synthetic DST boundary exception review",
          reviewConfirmed: true,
          warningsAcknowledged: true,
        });
        expect(r.statusCode, r.body).toBe(200);
        const account = await month(
          employee.cookie,
          employee.membershipId,
          period,
        );
        expect(account.account.totals.approvedMs).toBe(hours * 3600000);
        expect(account.account.timezone).toBe("Europe/Tirane");
        expect(
          account.account.targetDays.some(
            (d: { countryCode: string }) => d.countryCode === "AL",
          ),
        ).toBe(true);
      }
    }, 60000);

    it("actual overnight work and paid/unpaid breaks reconcile across two calendar months", async () => {
      const night = await de.addEmployee("Synthetic Night Boundary Worker");
      await configure(night);
      now = new Date("2030-10-31T22:30Z");
      let r = await punch(night.cookie, "CLOCK_IN", 0);
      expect(r.statusCode, r.body).toBe(200);
      const id = r.json().attendanceId;
      now = new Date("2030-10-31T22:45Z");
      expect(
        (await punch(night.cookie, "BREAK_START", 1, { breakKind: "UNPAID" }))
          .statusCode,
      ).toBe(200);
      now = new Date("2030-10-31T23:15Z");
      expect((await punch(night.cookie, "BREAK_END", 2)).statusCode).toBe(200);
      now = new Date("2030-10-31T23:30Z");
      expect(
        (await punch(night.cookie, "BREAK_START", 3, { breakKind: "PAID" }))
          .statusCode,
      ).toBe(200);
      now = new Date("2030-10-31T23:45Z");
      expect((await punch(night.cookie, "BREAK_END", 4)).statusCode).toBe(200);
      now = new Date("2030-11-01T00:30Z");
      expect((await punch(night.cookie, "CLOCK_OUT", 5)).statusCode).toBe(200);
      r = await send(manager.cookie, "attendance/" + id + "/approval", {
        expectedVersion: 6,
        reason: "Reviewed exact two-month break sources",
        reviewConfirmed: true,
        warningsAcknowledged: true,
      });
      expect(r.statusCode, r.body).toBe(200);
      const oct = await month(night.cookie, night.membershipId, "2030-10"),
        nov = await month(night.cookie, night.membershipId, "2030-11");
      expect(oct.account.totals.approvedMs).toBe(15 * 60000);
      expect(nov.account.totals.approvedMs).toBe(75 * 60000);
      expect(oct.account.totals.actualUnpaidBreakMs).toBe(15 * 60000);
      expect(nov.account.totals.actualUnpaidBreakMs).toBe(15 * 60000);
      expect(nov.account.totals.actualPaidBreakMs).toBe(15 * 60000);
    });
    it("mid-month immutable contract changes allocate targets per effective working day", async () => {
      const previousClock = new Date(now);
      // Enter the immutable change before its effective date. Planning now
      // correctly shares the trusted clock with the actual/monthly ledgers.
      now = new Date("2030-08-15T08:00Z");
      const contractWorker = await de.addEmployee(
        "Synthetic Mid-contract Worker",
      );
      await configure(contractWorker);
      const profile = await send(
        de.owner.cookie,
        "profiles/" + contractWorker.membershipId,
      );
      const r = await send(
        de.owner.cookie,
        "profiles/" + contractWorker.membershipId + "/contracts",
        {
          expectedVersion: profile.json().version,
          effectiveFrom: "2030-08-16",
          employmentType: "PART_TIME",
          weeklyTargetMinutes: 1200,
          monthlyTargetMinutes: null,
          countryCode: "DE",
          terms: "Confidential new contract",
        },
      );
      expect(r.statusCode, r.body).toBe(200);
      const a = await month(contractWorker.cookie, contractWorker.membershipId);
      expect(
        a.account.targetDays.find(
          (d: { date: string }) => d.date === "2030-08-15",
        ).milliseconds,
      ).toBe(480 * 60000);
      expect(
        a.account.targetDays.find(
          (d: { date: string }) => d.date === "2030-08-16",
        ).milliseconds,
      ).toBe(240 * 60000);
      expect(
        new Set(
          a.account.entries
            .filter((e: { category: string }) => e.category === "TARGET")
            .map((e: { contractRevisionId: string }) => e.contractRevisionId),
        ).size,
      ).toBe(2);
      expect(JSON.stringify(a)).not.toContain("Confidential new contract");
      now = previousClock;
    });
    it("due published reminders/missing punches are deduplicated without inventing actual attendance", async () => {
      now = new Date("2030-10-07T06:30Z");
      const assignment = {
        id: key(),
        membershipId: peer.membershipId,
        station: "KITCHEN",
        startsLocal: "2030-10-07T09:00",
        endsLocal: "2030-10-07T17:00",
        startChoice: "reject",
        endChoice: "reject",
        breakMinutes: 30,
        requiredSkills: ["Food safety"],
        note: "",
      };
      const r = await send(
        de.owner.cookie,
        "schedule",
        {
          week: "2030-10-07",
          expectedVersion: 0,
          status: "PUBLISHED",
          reviewConfirmed: true,
          assignments: [assignment],
        },
        "PUT",
      );
      expect(r.statusCode, r.body).toBe(200);
      const count = await prisma.workforceAttendance.count({
        where: { userId: peer.userId },
      });
      await enqueueDueWorkforceReminders(now);
      const reminders = await prisma.workforceNotification.findMany({
        where: {
          userId: peer.userId,
          category: "SHIFT_REMINDER",
          subjectId: assignment.id,
        },
      });
      expect(reminders).toHaveLength(1);
      await enqueueDueWorkforceReminders(now);
      expect(
        await prisma.workforceNotification.count({
          where: {
            userId: peer.userId,
            category: "SHIFT_REMINDER",
            subjectId: assignment.id,
          },
        }),
      ).toBe(1);
      now = new Date("2030-10-07T07:20Z");
      await enqueueDueWorkforceReminders(now);
      const missing = await prisma.workforceNotification.findMany({
        where: {
          userId: peer.userId,
          category: "MISSING_PUNCH",
          subjectId: assignment.id,
        },
      });
      expect(missing).toHaveLength(1);
      expect(
        await prisma.workforceAttendance.count({
          where: { userId: peer.userId },
        }),
      ).toBe(count);
      const unrelated = await inbox(complete.cookie);
      expect(JSON.stringify(unrelated)).not.toContain(assignment.id);
      await preference(peer.cookie, true, false, 0);
      let p = await punch(peer.cookie, "CLOCK_IN", 0);
      expect(p.statusCode, p.body).toBe(200);
      const attendance = p.json().attendanceId;
      now = new Date("2030-10-08T00:00Z");
      await enqueueDueWorkforceReminders(now);
      expect(
        await prisma.workforceNotification.count({
          where: {
            userId: peer.userId,
            category: "MISSING_PUNCH",
            subjectId: attendance,
          },
        }),
      ).toBe(1);
      await enqueueDueWorkforceReminders(now);
      expect(
        await prisma.workforceNotification.count({
          where: {
            userId: peer.userId,
            category: "MISSING_PUNCH",
            subjectId: attendance,
          },
        }),
      ).toBe(1);
      p = await punch(peer.cookie, "CLOCK_OUT", 1);
      expect(p.statusCode, p.body).toBe(200);
      const messages: string[] = [],
        w = createWorkforceNotificationWorker({
          emailService: {
            async send(n) {
              if (n.kind === "WORKFORCE_UPDATE")
                messages.push(n.notificationId);
            },
          },
          emailProvider: "test",
          clock: () => new Date(now),
        });
      await w.runOnce(500);
      const obsolete = await prisma.workforceNotificationDelivery.findMany({
        where: { notificationId: { in: missing.map((n) => n.id) } },
      });
      expect(obsolete.every((d) => d.state !== "DELIVERED")).toBe(true);
    }, 60000);

    it("same canonical user in two venues has separate complete statements and cannot leak across venue sessions", async () => {
      const venue = await prisma.venue.create({
        data: {
          tenantId: de.owner.tenantId,
          name: "Synthetic Second Account Venue",
          slug: "account-second-" + key(),
          timezone: "Europe/Berlin",
          countryCode: "DE",
          currency: "EUR",
        },
      });
      const ownerMember = await prisma.membership.create({
          data: {
            tenantId: de.owner.tenantId,
            venueId: venue.id,
            userId: de.owner.userId,
            role: "OWNER",
          },
        }),
        member = await prisma.membership.create({
          data: {
            tenantId: de.owner.tenantId,
            venueId: venue.id,
            userId: complete.userId,
            role: "WAITER",
          },
        });
      for (const [membership, user] of [
        [ownerMember, de.owner],
        [member, complete],
      ] as const)
        await prisma.staffProfile.create({
          data: {
            tenantId: de.owner.tenantId,
            venueId: venue.id,
            userId: user.userId,
            membershipId: membership.id,
          },
        });
      const login = async (user: typeof complete | typeof de.owner) => {
        const r = await app.inject({
          method: "POST",
          url: "/v1/auth/login",
          payload: {
            tenantSlug: de.owner.tenantSlug,
            venueSlug: venue.slug,
            email: user.email,
            password: user.password,
          },
        });
        expect(r.statusCode, r.body).toBe(200);
        return r.cookies.map((c) => c.name + "=" + c.value).join("; ");
      };
      const ownerCookie = await login(de.owner),
        employeeCookie = await login(complete);
      let r = await send(
        ownerCookie,
        "profiles/" + member.id,
        {
          expectedVersion: 0,
          employmentStartedOn: "2026-01-01",
          stations: ["KITCHEN"],
          skills: [],
        },
        "PUT",
      );
      expect(r.statusCode, r.body).toBe(200);
      r = await send(ownerCookie, "profiles/" + member.id + "/contracts", {
        expectedVersion: 1,
        effectiveFrom: "2026-01-01",
        employmentType: "PART_TIME",
        weeklyTargetMinutes: 1200,
        monthlyTargetMinutes: null,
        countryCode: "DE",
        terms: "Explicit second-venue allocation; no copied employee",
      });
      expect(r.statusCode, r.body).toBe(200);
      r = await send(ownerCookie, "policy", {
        expectedVersion: 0,
        effectiveFrom: "2026-01-01",
        countryCode: "DE",
        rules: workforceDefaultRules("DE"),
        reason: "Synthetic scoped policy",
      });
      expect(r.statusCode, r.body).toBe(200);
      r = await send(ownerCookie, "account-policies", {
        expectedVersion: 0,
        effectiveFrom: "2026-01-01",
        countryCode: "DE",
        rules: {
          ...rules,
          holidays: [],
          carryoverMode: "NONE",
          openingMonth: null,
        },
        reason: "Explicit venue contract allocation",
        reviewConfirmed: true,
      });
      expect(r.statusCode, r.body).toBe(200);
      now = new Date("2030-11-05T08:00Z");
      r = await punch(employeeCookie, "CLOCK_IN", 0);
      expect(r.statusCode, r.body).toBe(200);
      const id = r.json().attendanceId;
      now = new Date("2030-11-05T09:00Z");
      expect((await punch(employeeCookie, "CLOCK_OUT", 1)).statusCode).toBe(
        200,
      );
      r = await send(ownerCookie, "attendance/" + id + "/approval", {
        expectedVersion: 2,
        reason: "Scoped second-venue approval",
        reviewConfirmed: true,
        warningsAcknowledged: true,
      });
      expect(r.statusCode, r.body).toBe(200);
      const first = await month(
          complete.cookie,
          complete.membershipId,
          "2030-11",
        ),
        second = await month(employeeCookie, member.id, "2030-11");
      expect(first.account.totals.approvedMs).toBe(0);
      expect(second.account.totals.approvedMs).toBe(60 * 60000);
      expect(second.employee.userId).toBe(first.employee.userId);
      expect(second.employee.profileId).not.toBe(first.employee.profileId);
      for (const cookie of [manager.cookie, de.owner.cookie])
        expect(
          (
            await send(
              cookie,
              "monthly-account?month=2030-11&membershipId=" + member.id,
            )
          ).statusCode,
        ).toBe(404);
      expect(
        (
          await send(
            employeeCookie,
            "monthly-account?month=2030-09&membershipId=" +
              complete.membershipId,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await send(
            manager.cookie,
            "monthly-account/export?month=2030-11&membershipId=" +
              member.id +
              "&format=csv&locale=en",
          )
        ).statusCode,
      ).toBe(404);
    }, 60000);
    it("durable expired lease recovery keeps one logical delivery and rejects a stale worker completion", async () => {
      now = new Date("2030-11-10T08:00Z");
      const drain = createWorkforceNotificationWorker({
        emailService: { async send() {} },
        emailProvider: "test",
        clock: () => new Date(now),
      });
      await drain.runOnce(500);
      const request = await send(complete.cookie, "leave", {
        idempotencyKey: key(),
        category: "UNPAID",
        from: "2030-11-15",
        to: "2030-11-15",
        partial: null,
      });
      expect(request.statusCode, request.body).toBe(200);
      const first = await workforceNotificationOutbox.claim(now);
      expect(first).not.toBeNull();
      now = new Date(now.getTime() + 121000);
      const second = await workforceNotificationOutbox.claim(now);
      expect(second?.id).toBe(first!.id);
      expect(second?.leaseToken).not.toBe(first!.leaseToken);
      expect(second?.attemptNumber).toBe(2);
      expect(
        (
          await workforceNotificationOutbox.finish(
            second!,
            "DELIVERED",
            "TEST",
            null,
            now,
          )
        ).state,
      ).toBe("DELIVERED");
      expect(
        (
          await workforceNotificationOutbox.finish(
            first!,
            "DELIVERED",
            "TEST",
            null,
            now,
          )
        ).recorded,
      ).toBe(false);
      const attempts =
        await prisma.workforceNotificationDeliveryAttempt.findMany({
          where: { deliveryId: first!.id },
          orderBy: { attemptNumber: "asc" },
        });
      expect(attempts.map((a) => a.outcome)).toEqual([
        "UNCERTAIN",
        "DELIVERED",
      ]);
    });
    it("queued venue-manager notices are hidden and disabled immediately after role revocation", async () => {
      const request = await send(complete.cookie, "leave", {
        idempotencyKey: key(),
        category: "UNPAID",
        from: "2030-11-16",
        to: "2030-11-16",
        partial: null,
      });
      expect(request.statusCode, request.body).toBe(200);
      const notice = await prisma.workforceNotification.findFirstOrThrow({
        where: { userId: manager.userId, subjectId: request.json().id },
      });
      const changed = await app.inject({
        method: "PATCH",
        url: "/v1/staff/team/members/" + manager.membershipId,
        headers: { cookie: de.owner.cookie },
        payload: { role: "WAITER" },
      });
      expect(changed.statusCode, changed.body).toBe(200);
      const personal = await inbox(manager.cookie);
      expect(
        personal.items.some((n: { id: string }) => n.id === notice.id),
      ).toBe(false);
      expect(
        (await send(manager.cookie, "monthly-statistics?month=2030-11"))
          .statusCode,
      ).toBe(403);
      const sent: string[] = [],
        workerProcess = createWorkforceNotificationWorker({
          emailService: {
            async send(n) {
              if (n.kind === "WORKFORCE_UPDATE") sent.push(n.notificationId);
            },
          },
          emailProvider: "test",
          clock: () => new Date(now),
        });
      await workerProcess.runOnce(500);
      expect(sent).not.toContain(notice.id);
      const rows = await prisma.workforceNotificationDelivery.findMany({
        where: { notificationId: notice.id },
      });
      expect(rows.every((r) => r.state !== "DELIVERED")).toBe(true);
      expect(
        (
          await app.inject({
            method: "PATCH",
            url: "/v1/staff/team/members/" + manager.membershipId,
            headers: { cookie: de.owner.cookie },
            payload: { role: "MANAGER" },
          })
        ).statusCode,
      ).toBe(200);
    });

    it("explicit partial paid-credit rules exclude only worked overlaps and preserve unpaid absence reporting", async () => {
      now = new Date("2030-12-01T08:00Z");
      let r = await send(de.owner.cookie, "account-policies", {
        expectedVersion: 1,
        effectiveFrom: "2030-12-01",
        countryCode: "DE",
        rules: {
          ...rules,
          holidays: [],
          carryoverMode: "NONE",
          openingMonth: null,
          creditOverlapRule: "EXCLUDE_RECORDED_WORK",
          overtimeBasis: "EARNED_OVER_TARGET",
        },
        reason: "Explicit partial-leave time accounting review",
        reviewConfirmed: true,
      });
      expect(r.statusCode, r.body).toBe(200);
      const partial = await de.addEmployee("Synthetic Partial Credit Worker");
      await configure(partial);
      const profile = await send(
        de.owner.cookie,
        "profiles/" + partial.membershipId,
      );
      r = await send(
        de.owner.cookie,
        "profiles/" + partial.membershipId,
        {
          expectedVersion: profile.json().version,
          employmentStartedOn: "2030-12-10",
          employmentEndedOn: "2030-12-10",
        },
        "PUT",
      );
      expect(r.statusCode, r.body).toBe(200);
      r = await send(de.owner.cookie, "leave-allowance", {
        membershipId: partial.membershipId,
        year: 2030,
        minutes: 480,
        expectedVersion: 0,
        reason: "Explicit one-day synthetic leave allowance",
        idempotencyKey: key(),
      });
      expect(r.statusCode, r.body).toBe(200);
      const paid = await send(partial.cookie, "leave", {
        idempotencyKey: key(),
        category: "ANNUAL",
        from: "2030-12-10",
        to: "2030-12-10",
        partial: {
          startsLocal: "2030-12-10T09:00",
          endsLocal: "2030-12-10T11:00",
          startChoice: "reject",
          endChoice: "reject",
        },
      });
      expect(paid.statusCode, paid.body).toBe(200);
      expect((await decision(manager.cookie, paid.json().id)).statusCode).toBe(
        200,
      );
      now = new Date("2030-12-10T10:00Z");
      r = await punch(partial.cookie, "CLOCK_IN", 0);
      expect(r.statusCode, r.body).toBe(200);
      const id = r.json().attendanceId;
      now = new Date("2030-12-10T14:00Z");
      expect(
        (await punch(partial.cookie, "BREAK_START", 1, { breakKind: "UNPAID" }))
          .statusCode,
      ).toBe(200);
      now = new Date("2030-12-10T14:30Z");
      expect((await punch(partial.cookie, "BREAK_END", 2)).statusCode).toBe(
        200,
      );
      now = new Date("2030-12-10T18:30Z");
      expect((await punch(partial.cookie, "CLOCK_OUT", 3)).statusCode).toBe(
        200,
      );
      r = await send(manager.cookie, "attendance/" + id + "/approval", {
        expectedVersion: 4,
        reason: "Reviewed actual work outside approved partial leave",
        reviewConfirmed: true,
        warningsAcknowledged: true,
      });
      expect(r.statusCode, r.body).toBe(200);
      const a = await month(partial.cookie, partial.membershipId, "2030-12");
      expect(a.account.totals.targetMs).toBe(480 * 60000);
      expect(a.account.totals.approvedMs).toBe(480 * 60000);
      expect(a.account.totals.creditedMs).toBe(120 * 60000);
      expect(a.account.totals.balanceMs).toBe(120 * 60000);
      expect(a.account.totals.overtimeMs).toBe(120 * 60000);
      expect(a.account.absences[0]).toMatchObject({
        category: "ANNUAL",
        status: "APPROVED",
        chargedMinutes: 120,
        creditedMs: 120 * 60000,
      });
      const unpaid = await send(partial.cookie, "leave", {
        idempotencyKey: key(),
        category: "UNPAID",
        from: "2030-12-11",
        to: "2030-12-11",
        partial: null,
      });
      expect(unpaid.statusCode, unpaid.body).toBe(200);
      expect(
        (await decision(manager.cookie, unpaid.json().id)).statusCode,
      ).toBe(200);
      const later = await month(
        partial.cookie,
        partial.membershipId,
        "2030-12",
      );
      expect(
        later.account.absences.some(
          (a: { category: string; creditedMs: number }) =>
            a.category === "UNPAID" && a.creditedMs === 0,
        ),
      ).toBe(true);
      expect(later.account.totals.creditedMs).toBe(120 * 60000);
    }, 60000);
    it("counts 10,020 notices and receipts in PostgreSQL with scoped purpose visibility and stable cursors", async () => {
      const recipient = await de.addEmployee(
        "Synthetic large inbox",
        "MANAGER",
      );
      const count = 10020,
        prefixId = key(),
        createdAt = new Date("2030-12-01T10:00Z");
      // A2 volume fixture only: no public operation exists to fabricate historical
      // notices/receipts. Normal registration/invitation/auth and read/ack remain real.
      for (let offset = 0; offset < count; offset += 1000) {
        const indices = Array.from(
          { length: Math.min(1000, count - offset) },
          (_, i) => offset + i,
        );
        await prisma.workforceNotification.createMany({
          data: indices.map((i) => ({
            id: prefixId + ":" + String(i).padStart(5, "0"),
            tenantId: recipient.tenantId,
            venueId: recipient.venueId,
            userId: recipient.userId,
            membershipId: recipient.membershipId,
            eventKey: prefixId + ":" + i,
            schemaVersion: 1,
            sourceKind: "A2_VOLUME_FIXTURE",
            subjectId: prefixId,
            requiredPermission: i % 2 === 0 ? "SELF" : "VENUE_MANAGER",
            category: "MONTHLY_STATEMENT",
            locale: "en",
            important: true,
            payload: { link: { tab: "month", month: "2030-12" } },
            createdAt,
          })),
        });
        await prisma.workforceNotificationReceipt.createMany({
          data: indices.map((i) => ({
            id: key(),
            tenantId: recipient.tenantId,
            venueId: recipient.venueId,
            userId: recipient.userId,
            notificationId: prefixId + ":" + String(i).padStart(5, "0"),
            version: 0,
            readAt: i % 3 === 0 ? null : createdAt,
            acknowledgedAt: null,
          })),
        });
      }
      // Warm the same statement with tiny inboxes before this large recipient:
      // PostgreSQL may choose a generic prepared plan after repeated executions.
      for (let i = 0; i < 8; i++) await inbox(peer.cookie);
      const query = workforceUnreadCountQuery(recipient);
      const plan = await prisma.$queryRawUnsafe<any[]>(
        "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + query.text,
        ...query.values,
      );
      const evidence = plan[0]["QUERY PLAN"][0];
      const genericPlan = await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(
            "SET LOCAL plan_cache_mode = force_generic_plan",
          );
          await tx.$executeRawUnsafe(
            "PREPARE wf3_unread_volume AS " + query.text,
          );
          try {
            // EXPLAIN EXECUTE does not accept protocol bind parameters. These test
            // values are quoted as SQL string literals, never shell-interpolated.
            const literals = query.values
              .map((value) => {
                if (typeof value !== "string")
                  throw new Error("Expected text query parameter");
                return "'" + value.replaceAll("'", "''") + "'";
              })
              .join(",");
            const result = await tx.$queryRawUnsafe<any[]>(
              "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE wf3_unread_volume(" +
                literals +
                ")",
            );
            return result[0]["QUERY PLAN"][0];
          } finally {
            await tx.$executeRawUnsafe("DEALLOCATE wf3_unread_volume");
          }
        },
        { timeout: 10000 },
      );

      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir("../../artifacts/workforce-wf3", { recursive: true });
      await writeFile(
        "../../artifacts/workforce-wf3/unread-query-plan.json",
        JSON.stringify(
          {
            noticeCount: count,
            receiptCount: count,
            expectedUnread: 3340,
            plan: evidence,
            genericPlan,
          },
          null,
          2,
        ),
      );
      expect(JSON.stringify(evidence.Plan)).toMatch(/Anti/);
      expect(evidence["Execution Time"]).toBeLessThan(5000);
      expect(genericPlan["Execution Time"]).toBeLessThan(5000);
      const first = await inbox(recipient.cookie);
      expect(first.unreadCount).toBe(3340);
      const ids: string[] = [];
      let page = first;
      while (true) {
        ids.push(...page.items.map((n: { id: string }) => n.id));
        if (!page.nextCursor) break;
        const r = await send(
          recipient.cookie,
          "notifications?locale=en&cursor=" + page.nextCursor,
        );
        expect(r.statusCode, r.body).toBe(200);
        page = r.json();
      }
      expect(ids).toHaveLength(count);
      expect(new Set(ids).size).toBe(count);
      const unreadId = prefixId + ":00000";
      expect(
        (
          await send(
            recipient.cookie,
            "notifications/" + unreadId + "/read",
            {},
          )
        ).statusCode,
      ).toBe(200);
      expect((await inbox(recipient.cookie)).unreadCount).toBe(3339);
      expect(
        (
          await send(
            recipient.cookie,
            "notifications/" + unreadId + "/acknowledgment",
            { reviewConfirmed: true },
          )
        ).statusCode,
      ).toBe(200);
      expect((await inbox(recipient.cookie)).unreadCount).toBe(3339);
      expect(
        (
          await send(
            al.owner.cookie,
            "notifications?locale=en&cursor=" + first.nextCursor,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (await send(peer.cookie, "notifications/" + unreadId + "/read", {}))
          .statusCode,
      ).toBe(404);
      const downgraded = await app.inject({
        method: "PATCH",
        url: "/v1/staff/team/members/" + recipient.membershipId,
        headers: { cookie: de.owner.cookie },
        payload: { role: "WAITER" },
      });
      expect(downgraded.statusCode, downgraded.body).toBe(200);
      expect((await inbox(recipient.cookie)).unreadCount).toBe(1669);
      expect(
        (
          await send(
            recipient.cookie,
            "notifications?locale=en&cursor=" + prefixId + ":00001",
          )
        ).statusCode,
      ).toBe(404);
      const revoked = await app.inject({
        method: "PATCH",
        url: "/v1/staff/team/members/" + recipient.membershipId,
        headers: { cookie: de.owner.cookie },
        payload: { active: false },
      });
      expect(revoked.statusCode, revoked.body).toBe(200);
      expect(
        (await send(recipient.cookie, "notifications?locale=en")).statusCode,
      ).toBe(401);
    }, 120000);
    it("deactivation retains immutable monthly history but blocks deliveries and personal API access", async () => {
      const before = await month(manager.cookie),
        r = await app.inject({
          method: "PATCH",
          url: "/v1/staff/team/members/" + worker.membershipId,
          headers: { cookie: de.owner.cookie },
          payload: { active: false },
        });
      expect(r.statusCode, r.body).toBe(200);
      expect(
        (await send(worker.cookie, "monthly-account?month=2030-08")).statusCode,
      ).toBe(401);
      expect((await month(manager.cookie)).closing.original).toEqual(
        before.closing.original,
      );
      const delivered: string[] = [],
        workerProcess = createWorkforceNotificationWorker({
          emailService: {
            async send(n) {
              if (n.kind === "WORKFORCE_UPDATE") delivered.push(n.recipient);
            },
          },
          emailProvider: "test",
          clock: () => new Date(now),
        });
      await workerProcess.runOnce(100);
      expect(delivered).not.toContain(worker.email);
    });
  });
