import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  workforceDefaultRules,
  workforceNotificationCategories,
  type WorkforceAccountRules,
  type WorkforceAssignment,
} from "@flowgastronomie/domain";
import {
  prisma,
  workforceRepository,
  createWorkforceOperationsRepository,
  createWorkforceAccountRepository,
  workforceNotificationRepository,
} from "@flowgastronomie/database";
import { buildApp } from "../../apps/api/src/app.js";
import { workforceFixture } from "../workforce/fixtures.js";
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !/^workforce_wf3_browser_\d+$/.test(url.searchParams.get("schema") ?? "") ||
    process.env.WORKFORCE_WF3_BROWSER_GATE !== "true" ||
    process.env.NODE_ENV === "production"
  )
    throw new Error("Isolated local WF3 browser fixture required");
  let now = new Date("2030-08-12T07:00Z");
  const clock = () => new Date(now),
    app = buildApp({}, { workforceClock: clock }),
    ops = createWorkforceOperationsRepository(clock),
    accounts = createWorkforceAccountRepository(clock),
    actors: Record<string, unknown> = {};
  app.post("/__fixture/workforce-wf3/clock", async (request) => {
    const b = z
      .object({ now: z.string().datetime() })
      .strict()
      .parse(request.body);
    now = new Date(b.now);
    return { now: now.toISOString() };
  });
  for (const locale of ["en", "de", "it", "sq"] as const) {
    now = new Date("2030-08-12T07:00Z");
    const country = locale === "sq" ? "AL" : "DE",
      fixture = await workforceFixture(
        app,
        country,
        "127.0.0." + { en: 31, de: 32, it: 33, sq: 34 }[locale],
      ),
      manager = await fixture.addEmployee("Synthetic Month Manager", "MANAGER"),
      worker = await fixture.addEmployee("Synthetic Crew A"),
      peer = await fixture.addEmployee("Synthetic Crew B");
    for (const member of [manager, worker, peer]) {
      await workforceRepository.saveProfile(
        fixture.owner,
        member.membershipId,
        {
          expectedVersion: 0,
          employmentStartedOn: "2026-01-01",
          stations: ["KITCHEN"],
          skills: ["Food safety"],
          annualLeaveDays: 24,
        },
      );
      await workforceRepository.addContract(
        fixture.owner,
        member.membershipId,
        {
          expectedVersion: 1,
          effectiveFrom: "2026-01-01",
          employmentType: "FULL_TIME",
          weeklyTargetMinutes: 2400,
          monthlyTargetMinutes: null,
          countryCode: country,
          terms: "Synthetic private contract; never exported",
        },
      );
      await workforceNotificationRepository.savePreferences(
        member,
        {
          expectedVersion: 0,
          locale,
          emailEnabled: false,
          pushEnabled: false,
          reminderMinutes: 60,
          categories: [...workforceNotificationCategories],
          consentConfirmed: true,
        },
        clock(),
      );
    }
    await ops.configure(fixture.owner, {
      expectedVersion: 0,
      effectiveFrom: "2026-01-01",
      countryCode: country,
      rules: {
        ...workforceDefaultRules(country),
        excludedLeaveDates: ["2030-08-19"],
      },
      reason: "Reviewed synthetic country calendar",
    });
    const rules: WorkforceAccountRules = {
      timezone: country === "AL" ? "Europe/Tirane" : "Europe/Berlin",
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
    await accounts.configure(fixture.owner, {
      expectedVersion: 0,
      effectiveFrom: "2026-01-01",
      countryCode: country,
      rules,
      reason: "Reviewed synthetic contract, calendar and retention",
      reviewConfirmed: true,
    });
    await ops.grant(fixture.owner, {
      membershipId: worker.membershipId,
      year: 2030,
      minutes: 4800,
      expectedVersion: 0,
      reason: "Synthetic explicit opening leave bank",
      idempotencyKey: randomUUID(),
    });
    const row = (
      membershipId: string | null,
      day: string,
    ): WorkforceAssignment => ({
      id: randomUUID(),
      membershipId,
      station: "KITCHEN",
      startsLocal: day + "T09:00",
      endsLocal: day + "T17:00",
      startChoice: "reject",
      endChoice: "reject",
      breakMinutes: 30,
      requiredSkills: ["Food safety"],
      note: "",
    });
    const assignments = [
      row(worker.membershipId, "2030-08-12"),
      row(worker.membershipId, "2030-08-15"),
      row(peer.membershipId, "2030-08-16"),
      row(null, "2030-08-14"),
    ];
    await workforceRepository.saveSchedule(manager, {
      week: "2030-08-12",
      expectedVersion: 0,
      status: "PUBLISHED",
      reviewConfirmed: true,
      assignments,
    });
    await workforceRepository.saveSchedule(manager, {
      week: "2030-08-19",
      expectedVersion: 0,
      status: "PUBLISHED",
      reviewConfirmed: true,
      assignments: [row(worker.membershipId, "2030-08-20")],
    });
    const attendance = await ops.punch(worker, {
      kind: "CLOCK_IN",
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
    });
    now = new Date("2030-08-12T10:00Z");
    await ops.punch(worker, {
      kind: "BREAK_START",
      breakKind: "UNPAID",
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
    });
    now = new Date("2030-08-12T10:30Z");
    await ops.punch(worker, {
      kind: "BREAK_END",
      expectedVersion: 2,
      idempotencyKey: randomUUID(),
    });
    now = new Date("2030-08-12T15:00Z");
    await ops.punch(worker, {
      kind: "CLOCK_OUT",
      expectedVersion: 3,
      idempotencyKey: randomUUID(),
    });
    await ops.approveAttendance(
      manager,
      attendance.attendanceId,
      4,
      "Reviewed synthetic complete work",
      true,
      true,
    );
    const leave = await ops.requestLeave(worker, {
      idempotencyKey: randomUUID(),
      category: "ANNUAL",
      from: "2030-08-14",
      to: "2030-08-14",
      partial: null,
    });
    await ops.decide(manager, leave.id, {
      expectedVersion: 0,
      action: "APPROVE",
      reason: "Reviewed synthetic leave",
      reviewConfirmed: true,
      warningsAcknowledged: true,
    });
    const sanitize = (actor: typeof worker) => {
      const { cookie, ...safe } = actor;
      return safe;
    };
    actors[locale] = {
      owner: sanitize(fixture.owner),
      manager: sanitize(manager),
      worker: sanitize(worker),
      peer: sanitize(peer),
      attendanceId: attendance.attendanceId,
      assignmentIds: assignments.map((a) => a.id),
      country,
    };
  }
  now = new Date("2030-09-02T08:00Z");
  await mkdir("artifacts/workforce-wf3", { recursive: true });
  await writeFile(
    "artifacts/workforce-wf3/actors.json",
    JSON.stringify(actors, null, 2),
  );
  await app.listen({ host: "127.0.0.1", port: 4405 });
  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}
main().catch(async () => {
  console.error("WF3 synthetic fixture initialization failed");
  await prisma.$disconnect();
  process.exit(1);
});
