import { runEdgeScenarios } from "./edge-scenarios.js";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import {
  prisma,
  workforceNotificationRepository,
  workforceNotificationOutbox,
  enqueueDueWorkforceReminders,
} from "@flowgastronomie/database";
import {
  workforceDefaultRules,
  workforceNotificationCategories,
} from "@flowgastronomie/domain";
import { createWorkforceNotificationWorker } from "../../apps/api/src/workforce-notification-worker.js";
import { disabledTransactionalNotificationService } from "../../apps/api/src/transactional-notifications.js";
import { workforceFixture } from "../workforce/fixtures.js";
import {
  configs,
  dayAdd,
  monday,
  instant,
  expectedMonth,
  expectedFollowingMonth,
  intervalTotals,
  reconcile,
  targetMinutes,
  type Plan,
  type Interval,
  type LedgerWorker,
} from "./oracle.js";
export type Clock = { now: number };
export type Actor = Awaited<
  ReturnType<Awaited<ReturnType<typeof workforceFixture>>["addEmployee"]>
>;
type Worker = {
  actor: Actor;
  ledger: LedgerWorker;
  profileVersion: number;
  attendance: {
    id: string;
    version: number;
    interval: Interval;
    localStart: string;
    localEnd: string;
  }[];
};
export type Business = {
  config: (typeof configs)[number];
  owner: Actor;
  managers: Actor[];
  workers: Worker[];
  plans: Plan[];
  leaves: Map<string, string>;
  schedules: Map<string, any>;
};
export async function runWorkforceMonth(
  app: FastifyInstance,
  clock: Clock,
  browser = false,
) {
  const root = "artifacts/workforce-wf4";
  await mkdir(root, { recursive: true });
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert(
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
      /^workforce_wf4_\d+$/.test(url.searchParams.get("schema") ?? "") &&
      process.env.NODE_ENV !== "production" &&
      process.env.WORKFORCE_WF4_GATE === "true",
    "Isolated local WF4 schema required",
  );
  const started = Date.now(),
    log: any[] = [],
    daily: any[] = [],
    reports: any[] = [],
    checks: string[] = [],
    businesses: Business[] = [];
  const counts = {
    businesses: 2,
    workers: 16,
    managers: 4,
    contracts: 0,
    daysPerBusiness: 31,
    plannedShifts: 0,
    attendance: 0,
    punches: 0,
    breaks: 0,
    approvals: 0,
    leaveDecisions: 0,
    swapDecisions: 0,
    openClaims: 0,
    closes: 0,
    adjustments: 0,
    apiCalls: 0,
  };
  const key = () => randomUUID();
  async function response(
    actor: Actor,
    path: string,
    payload?: unknown,
    method = payload ? "POST" : "GET",
    expected = 200,
  ) {
    const r = await app.inject({
      method: method as any,
      url: path.startsWith("/v1/")
        ? path
        : path.startsWith("?")
          ? "/v1/staff/workforce" + path
          : "/v1/staff/workforce/" + path,
      headers: { cookie: actor.cookie },
      ...(payload === undefined ? {} : { payload: payload as any }),
    });
    counts.apiCalls++;
    if (r.statusCode !== expected)
      await writeFile(
        root + "/failure.json",
        JSON.stringify(
          {
            at: new Date(clock.now).toISOString(),
            actor: actor.displayName,
            venueId: actor.venueId,
            path,
            expected,
            status: r.statusCode,
            kind: (payload as any)?.kind,
            expectedVersion: (payload as any)?.expectedVersion,
            body: r.body,
          },
          null,
          2,
        ),
      );
    assert.equal(
      r.statusCode,
      expected,
      `${new Date(clock.now).toISOString()} ${actor.displayName} ${method} ${path}: ${r.body}`,
    );
    log.push({
      at: new Date(clock.now).toISOString(),
      tenantId: actor.tenantId,
      venueId: actor.venueId,
      userId: actor.userId,
      action: method + " " + path.split("?")[0],
      status: r.statusCode,
    });
    return r;
  }
  const api = async (
    actor: Actor,
    path: string,
    payload?: unknown,
    method?: string,
  ) => (await response(actor, path, payload, method)).json();
  async function decide(
    b: Business,
    id: string,
    action = "APPROVE",
    version = 0,
    actor = b.managers[0]!,
  ) {
    return api(actor, "requests/" + id + "/decision", {
      expectedVersion: version,
      action,
      reason: "Reviewed synthetic WF4 source evidence",
      reviewConfirmed: true,
      warningsAcknowledged: true,
    });
  }
  function assignment(b: Business, p: Plan) {
    return {
      id: p.id,
      membershipId:
        p.worker === null ? null : b.workers[p.worker]!.actor.membershipId,
      station: p.station,
      startsLocal: p.startsLocal,
      endsLocal: p.endsLocal,
      startChoice: "reject",
      endChoice: "reject",
      breakMinutes: p.breakMinutes,
      requiredSkills: ["WF4 hygiene"],
      note: "Synthetic WF4 operational fixture",
    };
  }
  function syncPlans(b: Business) {
    for (let i = 0; i < b.workers.length; i++)
      b.workers[i]!.ledger.planned = b.plans.filter((p) => p.worker === i);
  }
  async function publish(b: Business, week: string) {
    const old = b.schedules.get(week);
    const saved = await api(
      b.managers[0]!,
      "schedule",
      {
        week,
        expectedVersion: old?.version ?? 0,
        status: "PUBLISHED",
        reviewConfirmed: true,
        assignments: b.plans
          .filter((p) => monday(p.day) === week && !p.cancelled)
          .map((p) => assignment(b, p)),
      },
      "PUT",
    );
    if (!old) {
      const expected = [
        ...new Set(
          b.plans
            .filter(
              (p) =>
                monday(p.day) === week && !p.cancelled && p.worker !== null,
            )
            .map((p) => b.workers[p.worker!]!.actor.userId),
        ),
      ].sort();
      const notices = await prisma.workforceNotification.findMany({
        where: {
          tenantId: b.owner.tenantId,
          venueId: b.owner.venueId,
          eventKey: "PUBLICATION:" + saved.id + ":" + saved.version,
        },
        select: { userId: true },
      });
      assert.deepEqual(
        notices.map((n) => n.userId).sort(),
        expected,
        "publication targets only explicit assigned workers",
      );
    }
    b.schedules.set(week, saved);
    syncPlans(b);
    return saved;
  }
  function addPlan(
    b: Business,
    worker: number | null,
    day: string,
    start = "10:00",
    minutes = 480,
  ) {
    const startsLocal = day + "T" + start,
      startMs = instant(startsLocal),
      endLocal = new Date(Date.parse(startsLocal + "Z") + minutes * 60000)
        .toISOString()
        .slice(0, 16);
    const p: Plan = {
      id: key(),
      worker,
      day,
      startsLocal,
      endsLocal: endLocal,
      start: startMs,
      end: instant(endLocal),
      breakMinutes: minutes >= 360 ? 30 : minutes >= 180 ? 15 : 0,
      station: b.config.stations[(worker ?? 1) % 4]!,
    };
    b.plans.push(p);
    return p;
  }
  for (const config of configs) {
    clock.now = instant("2031-02-28T08:00");
    const fixture = await workforceFixture(
      app,
      config.country,
      config.country === "DE" ? "127.0.0.61" : "127.0.0.62",
      { name: config.name },
    );
    const actualVenue = await prisma.venue.findUniqueOrThrow({
      where: { id: fixture.owner.venueId },
    });
    assert.equal(actualVenue.currency, config.currency);
    assert.equal(actualVenue.timezone, config.timezone);
    assert.equal(actualVenue.countryCode, config.country);
    assert.equal(
      (
        await prisma.tenant.findUniqueOrThrow({
          where: { id: fixture.owner.tenantId },
        })
      ).kind,
      "REAL",
    );
    const managers = [
      await fixture.addEmployee(
        "WF4 " + config.country + " Manager A",
        "MANAGER",
      ),
      await fixture.addEmployee(
        "WF4 " + config.country + " Manager B",
        "MANAGER",
      ),
    ];
    const b: Business = {
      config,
      owner: fixture.owner,
      managers,
      workers: [],
      plans: [],
      leaves: new Map(),
      schedules: new Map(),
    };
    businesses.push(b);
    await api(
      b.owner,
      "stations",
      { expectedVersion: 0, stations: config.stations },
      "PUT",
    );
    for (let i = 0; i < 8; i++) {
      const role =
        i % 4 === 0
          ? "KITCHEN"
          : config.country === "AL" && i % 4 === 2
            ? "BAR"
            : "WAITER";
      const actor = await fixture.addEmployee(
        "WF4 " + config.country + " Worker " + (i + 1),
        role,
      );
      b.workers.push({
        actor,
        profileVersion: 2,
        attendance: [],
        ledger: {
          key: config.country + "-worker-" + (i + 1),
          contracts: [{ from: "2031-02-01", weeklyMinutes: config.weekly[i]! }],
          planned: [],
          actual: [],
          leave: [],
          carryMinutes: config.carry,
        },
      });
    }
    await api(b.owner, "policy", {
      expectedVersion: 0,
      effectiveFrom: "2031-02-01",
      countryCode: config.country,
      rules: {
        ...workforceDefaultRules(config.country),
        workingWeekdays: config.weekdays,
        paidBreaksAllowed: true,
        excludedLeaveDates: ["2031-03-17"],
      },
      reason: "Explicit synthetic country calendar and break review",
    });
    for (const [i, actor] of [
      ...b.workers.map((w) => w.actor),
      ...managers,
    ].entries()) {
      await api(
        b.owner,
        "profiles/" + actor.membershipId,
        {
          expectedVersion: 0,
          employmentStartedOn: "2031-02-01",
          stations: config.stations,
          skills: ["WF4 hygiene"],
          annualLeaveDays: 24,
          employeeRef: config.country + "-" + i,
        },
        "PUT",
      );
      await api(b.owner, "profiles/" + actor.membershipId + "/contracts", {
        expectedVersion: 1,
        effectiveFrom: "2031-02-01",
        employmentType:
          i < 8
            ? [
                "FULL_TIME",
                "PART_TIME",
                "PART_TIME",
                config.country === "DE" ? "MINIJOB" : "TEMPORARY",
                "TEMPORARY",
                "PART_TIME",
                "TEMPORARY",
                "FULL_TIME",
              ][i]
            : "FULL_TIME",
        weeklyTargetMinutes: config.weekly[i] ?? config.weekly[0],
        monthlyTargetMinutes: null,
        countryCode: config.country,
        terms: "Synthetic private WF4 contract",
      });
      counts.contracts++;
      await api(b.owner, "leave-allowance", {
        membershipId: actor.membershipId,
        year: 2031,
        minutes: 4800,
        expectedVersion: 0,
        reason: "Explicit synthetic opening allowance",
        idempotencyKey: key(),
      });
      await api(
        actor,
        "notification-preferences",
        {
          expectedVersion: 0,
          locale: config.country === "DE" ? "de" : "sq",
          emailEnabled: false,
          pushEnabled: false,
          reminderMinutes: 60,
          categories: [...workforceNotificationCategories],
          consentConfirmed: true,
        },
        "PUT",
      );
    }
    await api(b.owner, "account-policies", {
      expectedVersion: 0,
      effectiveFrom: "2031-02-01",
      countryCode: config.country,
      rules: {
        timezone: config.timezone,
        workingWeekdays: config.weekdays,
        targetBasis: "WEEKLY_WORKDAYS",
        plannedBreakTreatment: config.plannedPaid ? "PAID" : "UNPAID",
        plannedBreakAllocation: "PROPORTIONAL",
        paidLeaveCategories: ["ANNUAL", "SICKNESS"],
        holidays: [
          { date: "2031-03-17", label: "Confirmed synthetic calendar day" },
        ],
        creditOverlapRule: "LIMIT_TO_TARGET",
        overtimeBasis:
          config.country === "AL"
            ? "EARNED_OVER_TARGET"
            : "APPROVED_OVER_TARGET",
        carryoverMode: "BALANCE",
        carryPositiveLimitMinutes: null,
        carryNegativeLimitMinutes: null,
        openingMonth: "2031-03",
        openingBalanceMinutes: config.carry,
        retentionYears: 2,
        legalReviewConfirmed: true,
      },
      reason: "Explicit synthetic target credit carry and retention review",
      reviewConfirmed: true,
    });
    for (let d = 1; d <= 31; d++)
      for (let i = 0; i < 8; i++) {
        const day = "2031-03-" + String(d).padStart(2, "0");
        if (
          (d - 1 + i) % 7 >= config.weekdays.length ||
          (i === 0 && [1, 30].includes(d)) ||
          (i === 7 && d === 13) ||
          (i === 2 && d === 4) ||
          (i === 3 && d === 12) ||
          (i === 4 && d === 20) ||
          (i === 5 && d === 6)
        )
          continue;
        const minutes =
          config.country === "DE"
            ? [480, 360, 240, 120, 480, 360, 180, 480][i]!
            : [420, 360, 285, 210, 420, 360, 135, 420][i]!;
        const p = addPlan(b, i, day, "10:00", minutes);
        if (i === 0 && [29, 31].includes(d)) {
          p.startsLocal = day + "T22:00";
          p.endsLocal = dayAdd(day, 1) + "T06:00";
          p.start = instant(p.startsLocal);
          p.end = instant(p.endsLocal);
          p.breakMinutes = 30;
        }
      }
    const boundary = addPlan(b, 0, "2031-02-28", "22:00", 480);
    boundary.endsLocal = "2031-03-01T06:00";
    boundary.end = instant(boundary.endsLocal);
    boundary.breakMinutes = 30;
    addPlan(b, null, "2031-03-08", "10:00", 240);
    for (const week of [...new Set(b.plans.map((p) => monday(p.day)))].sort())
      await publish(b, week);
    for (const [index, date, category] of [
      [2, "2031-03-04", "ANNUAL"],
      [3, "2031-03-12", "SICKNESS"],
      [4, "2031-03-20", "UNPAID"],
      [5, "2031-03-06", "ANNUAL"],
    ] as const) {
      const w = b.workers[index]!,
        payload = {
          idempotencyKey: key(),
          category,
          from: date,
          to: date,
          partial: null,
        };
      const request = await api(w.actor, "leave", payload);
      assert.equal(
        (await api(w.actor, "leave", payload)).id,
        request.id,
        "duplicate leave intent",
      );
      const results = await Promise.all(
        b.managers.map((actor) =>
          app.inject({
            method: "POST",
            url: "/v1/staff/workforce/requests/" + request.id + "/decision",
            headers: { cookie: actor.cookie },
            payload: {
              expectedVersion: 0,
              action: "APPROVE",
              reason: "Independent concurrent synthetic reviewers",
              reviewConfirmed: true,
              warningsAcknowledged: true,
            },
          }),
        ),
      );
      assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
      counts.leaveDecisions++;
      b.leaves.set(String(index), request.id);
      w.ledger.leave.push({
        date,
        category,
        minutes: targetMinutes(w.ledger, date, config),
        status: "APPROVED",
      });
    }
  }
  assert.notEqual(businesses[0]!.owner.tenantId, businesses[1]!.owner.tenantId);
  // Unauthorized reads/clock input are rejected through the actual authentication boundary.
  await response(
    businesses[1]!.owner,
    "monthly-account?month=2031-03&membershipId=" +
      businesses[0]!.workers[0]!.actor.membershipId,
    undefined,
    "GET",
    404,
  );
  await response(
    businesses[0]!.workers[0]!.actor,
    "attendance/punch",
    {
      kind: "CLOCK_IN",
      expectedVersion: 0,
      idempotencyKey: key(),
      occurredAt: "2031-03-01T00:00Z",
    },
    "POST",
    400,
  );
  checks.push(
    "tenant isolation; device timestamp rejected; duplicate leave; concurrent reviewers",
  );
  type Job = { at: number; order: number; run: () => Promise<void> };
  const jobs: Job[] = [];
  const job = (at: number, run: () => Promise<void>, order = 0) =>
    jobs.push({ at, order, run });
  // Intent changes occur before the affected future shifts and alter only explicit oracle input ownership.
  for (const b of businesses) {
    job(instant("2031-03-05T08:00"), async () => {
      const p = b.plans.find(
        (p) => p.worker === null && p.day === "2031-03-08",
      )!;
      const eligible = b.workers.findIndex(
        (_, i) =>
          !b.plans.some(
            (x) => !x.cancelled && x.worker === i && x.day === p.day,
          ),
      );
      assert(eligible >= 0);
      const view = await api(
        b.workers[eligible]!.actor,
        "operations?from=2031-03-05&to=2031-03-12",
      );
      const source = view.shifts.find((x: any) => x.assignmentId === p.id);
      assert(source);
      const r = await api(b.workers[eligible]!.actor, "shift-requests", {
        idempotencyKey: key(),
        kind: "OPEN",
        assignmentId: p.id,
        publicationRevisionId: source.publicationRevisionId,
        targetMembershipId: null,
        otherAssignmentId: null,
        otherPublicationRevisionId: null,
      });
      await decide(b, r.id);
      p.worker = eligible;
      syncPlans(b);
      counts.openClaims++;
      const current = await api(
        b.managers[0]!,
        "?from=" + monday(p.day) + "&to=" + p.day,
      );
      b.schedules.set(
        monday(p.day),
        current.schedules.find((s: any) => s.week === monday(p.day)),
      );
    });
    job(instant("2031-03-13T08:00"), async () => {
      const first = b.plans.find(
        (p) =>
          p.worker === 0 &&
          p.day > "2031-03-13" &&
          p.day < "2031-03-25" &&
          !b.plans.some((x) => x.worker === 1 && x.day === p.day),
      );
      const second = b.plans.find(
        (p) =>
          p.worker === 1 &&
          p.day > "2031-03-13" &&
          p.day < "2031-03-25" &&
          !b.plans.some((x) => x.worker === 0 && x.day === p.day),
      );
      assert(first && second, "deterministic swap candidates");
      const view = await api(
          b.managers[0]!,
          "operations?from=2031-03-13&to=2031-03-25",
        ),
        a = view.shifts.find((x: any) => x.assignmentId === first.id),
        z = view.shifts.find((x: any) => x.assignmentId === second.id);
      const r = await api(b.workers[0]!.actor, "shift-requests", {
        idempotencyKey: key(),
        kind: "SWAP",
        assignmentId: first.id,
        publicationRevisionId: a.publicationRevisionId,
        targetMembershipId: b.workers[1]!.actor.membershipId,
        otherAssignmentId: second.id,
        otherPublicationRevisionId: z.publicationRevisionId,
      });
      await decide(b, r.id, "ACCEPT", 0, b.workers[1]!.actor);
      await decide(b, r.id, "APPROVE", 1);
      first.worker = 1;
      second.worker = 0;
      syncPlans(b);
      counts.swapDecisions++;
      const current = await api(
        b.managers[0]!,
        "?from=2031-03-10&to=2031-03-25",
      );
      for (const s of current.schedules) b.schedules.set(s.week, s);
    });
    job(instant("2031-03-15T08:00"), async () => {
      const w = b.workers[1]!,
        minutes = b.config.country === "DE" ? 1500 : 1800;
      await api(b.owner, "profiles/" + w.actor.membershipId + "/contracts", {
        expectedVersion: w.profileVersion,
        effectiveFrom: "2031-03-16",
        employmentType: "PART_TIME",
        weeklyTargetMinutes: minutes,
        monthlyTargetMinutes: null,
        countryCode: b.config.country,
        terms: "Synthetic future-dated target change",
      });
      w.profileVersion++;
      w.ledger.contracts.push({ from: "2031-03-16", weeklyMinutes: minutes });
      counts.contracts++;
    });
    job(instant("2031-03-26T00:01"), async () => {
      const w = b.workers[7]!;
      await api(
        b.owner,
        "profiles/" + w.actor.membershipId,
        {
          expectedVersion: w.profileVersion,
          employmentEndedOn: "2031-03-25",
          employmentStatus: "ENDED",
        },
        "PUT",
      );
      w.profileVersion++;
      w.ledger.endedOn = "2031-03-25";
      const affected = new Set<string>();
      for (const p of b.plans)
        if (p.worker === 7 && p.day > "2031-03-25") {
          p.cancelled = true;
          affected.add(monday(p.day));
        }
      for (const week of affected) await publish(b, week);
      await api(
        b.owner,
        "/v1/staff/team/members/" + w.actor.membershipId,
        { active: false },
        "PATCH",
      );
      await response(w.actor, "notifications?locale=en", undefined, "GET", 401);
    });
  }
  async function record(b: Business, p: Plan) {
    if (p.cancelled || p.worker === null) return;
    const w = b.workers[p.worker]!;
    if (w.ledger.endedOn && p.day > w.ledger.endedOn) return;
    let start = p.start,
      end = p.end;
    if (p.worker === 5 && p.day === "2031-03-07") start += 20 * 60000;
    if (p.worker === 6 && p.day === "2031-03-09") end -= 15 * 60000;
    const breakMinutes = p.breakMinutes,
      breakStart =
        p.day === "2031-03-31" && p.endsLocal.slice(0, 10) !== p.day
          ? instant("2031-04-01T00:30")
          : start + Math.min(180 * 60000, Math.floor((end - start) / 2));
    const interval: Interval = {
      start,
      end,
      breaks: breakMinutes
        ? [
            {
              start: breakStart,
              end: breakStart + breakMinutes * 60000,
              kind:
                (Number(p.day.slice(-2)) + p.worker) % 2 === 0
                  ? "PAID"
                  : "UNPAID",
            },
          ]
        : [],
      source: p.id,
    };
    for (const br of interval.breaks)
      assert(
        br.start >= start && br.end <= end,
        "Fixture break must remain inside its declared work interval: " +
          w.ledger.key +
          " " +
          p.day,
      );
    const missingIn = p.worker === 1 && p.day === "2031-03-11",
      missingOut = p.worker === 0 && p.day === "2031-03-10";
    let attendanceId = "",
      version = 0;
    const punch = async (kind: string, extra = {}) => {
      const payload = {
        kind,
        expectedVersion: version,
        idempotencyKey: key(),
        ...extra,
      };
      const r = await api(w.actor, "attendance/punch", payload);
      attendanceId = r.attendanceId;
      version = r.version ?? version + 1;
      counts.punches++;
      if (kind === "CLOCK_IN")
        assert.deepEqual(
          await api(w.actor, "attendance/punch", payload),
          r,
          "same-key punch retry",
        );
    };
    const correction = async (reason: string) => {
      const local = (ms: number) =>
        new Date(ms + (ms < instant("2031-03-30T03:00") ? 1 : 2) * 3600000)
          .toISOString()
          .slice(0, 16);
      const body = {
        idempotencyKey: key(),
        attendanceId: attendanceId || null,
        expectedAttendanceVersion: version,
        reason,
        startsLocal: local(start),
        endsLocal: local(end),
        startChoice: "reject",
        endChoice: "reject",
        breaks: interval.breaks.map((x) => ({
          startsLocal: local(x.start),
          endsLocal: local(x.end),
          startChoice: "reject",
          endChoice: "reject",
          kind: x.kind,
        })),
      };
      const r = await api(
        missingOut ? b.managers[0]! : w.actor,
        missingOut
          ? "attendance/" + attendanceId + "/recovery-request"
          : "corrections",
        body,
      );
      await decide(
        b,
        r.id,
        "APPROVE",
        0,
        missingOut ? b.managers[1]! : b.managers[0]!,
      );
      const data = await api(
        b.managers[0]!,
        "operations?from=" + p.day + "&to=" + dayAdd(p.day, 1),
      );
      const row = data.attendance.find(
        (x: any) =>
          x.userId === w.actor.userId &&
          x.actual?.startsAt === new Date(start).toISOString(),
      );
      assert(row, "corrected attendance source");
      attendanceId = row.id;
      version = row.version;
      if (missingIn)
        assert.deepEqual(
          row.events.map((e: any) => e.kind),
          ["CORRECTION"],
        );
      if (missingOut)
        assert(!row.events.some((e: any) => e.kind === "CLOCK_OUT"));
      counts.approvals++;
    };
    if (!missingIn) {
      job(start, async () => {
        await punch("CLOCK_IN");
        counts.attendance++;
      });
      for (const br of interval.breaks) {
        job(br.start, async () => {
          await punch("BREAK_START", { breakKind: br.kind });
          counts.breaks++;
        });
        job(br.end, async () => punch("BREAK_END"));
      }
    }
    job(
      end,
      async () => {
        if (missingIn) {
          await correction("MISSING_IN");
          counts.attendance++;
        } else if (missingOut) {
          await correction("MISSING_OUT");
        } else {
          await punch("CLOCK_OUT");
          await api(
            b.managers[0]!,
            "attendance/" + attendanceId + "/approval",
            {
              expectedVersion: version,
              reason: "Reviewed synthetic actual interval and deviations",
              reviewConfirmed: true,
              warningsAcknowledged: true,
            },
          );
          counts.approvals++;
        }
        w.ledger.actual.push(interval);
        w.attendance.push({
          id: attendanceId,
          version,
          interval,
          localStart: p.startsLocal,
          localEnd: p.endsLocal,
        });
      },
      2,
    );
  }
  // Populate event jobs by day after ownership-changing requests have completed.
  for (let d = "2031-02-28"; d <= "2031-03-31"; d = dayAdd(d, 1)) {
    const day = d;
    job(
      instant(day + "T08:30"),
      async () => {
        for (const b of businesses) {
          for (const p of b.plans.filter((p) => p.day === day))
            await record(b, p);
          if (day === "2031-03-13") {
            const p: Plan = {
              id: "UNSCHEDULED-" + b.config.country,
              worker: 7,
              day,
              startsLocal: day + "T15:00",
              endsLocal: day + "T18:00",
              start: instant(day + "T15:00"),
              end: instant(day + "T18:00"),
              breakMinutes: 15,
              station: b.config.stations[3]!,
            };
            await record(b, p);
          }
        }
      },
      1,
    );
  }
  job(instant("2031-03-07T10:16"), async () => {
    await enqueueDueWorkforceReminders(new Date(clock.now));
    checks.push("missing punch reminder without invented attendance");
  });
  while (jobs.length) {
    jobs.sort((a, b) => a.at - b.at || a.order - b.order);
    const next = jobs.shift()!;
    assert(next.at >= clock.now, "simulation clock cannot move backwards");
    clock.now = next.at;
    await next.run();
    assert(
      Date.now() - started < 15 * 60 * 1000,
      "WF4 simulation exceeded its bounded runtime",
    );
  }
  clock.now = instant("2031-04-02T09:00");
  for (const b of businesses) {
    syncPlans(b);
    const old = [...b.schedules.values()][0],
      week = old.week ?? monday("2031-02-28");
    const past =
      b.plans.find((p) => p.day === "2031-03-02" && !p.cancelled) ??
      b.plans.find((p) => p.day === "2031-03-01" && !p.cancelled)!;
    const view = await api(
        b.managers[0]!,
        "?from=" + monday(past.day) + "&to=" + past.day,
      ),
      s = view.schedules.find((x: any) => x.week === monday(past.day));
    const altered = s.snapshot.assignments.map((a: any) => ({
      id: a.id,
      membershipId: a.membershipId,
      station: a.station,
      startsLocal: a.startsLocal,
      endsLocal: a.endsLocal,
      startChoice: a.startChoice,
      endChoice: a.endChoice,
      breakMinutes: a.breakMinutes,
      requiredSkills: a.requiredSkills,
      note: a.note,
    }));
    altered[0].endsLocal = altered[0].endsLocal.slice(0, 11) + "19:00";
    const denied = await response(
      b.managers[0]!,
      "schedule",
      {
        week: s.week,
        expectedVersion: s.version,
        status: "DRAFT",
        assignments: altered,
      },
      "PUT",
      400,
    );
    assert.equal(denied.json().code, "PAST");
    assert.equal(view.today, "2031-04-02");
    checks.push(
      b.config.country + " trusted planning today and immutable past edits",
    );
    for (const [i, w] of b.workers.entries()) {
      const data = await api(
        b.managers[0]!,
        "monthly-account?month=2031-03&membershipId=" + w.actor.membershipId,
      );
      const expected = expectedMonth(w.ledger, b.config);
      reports.push(
        reconcile(
          data.account.totals,
          expected,
          w.ledger.key + " March before close",
        ),
      );
      assert.deepEqual(data.account.unapprovedAttendanceIds, []);
      assert.deepEqual(data.account.pendingRequestIds, []);
      const sources = await api(
        b.managers[0]!,
        "approved-hours?from=2031-03-01&to=2031-03-31",
      );
      assert.equal(sources.truncated, false);
      const own = sources.records.filter(
        (r: any) => r.userId === w.actor.userId,
      );
      assert.equal(
        own.length,
        w.attendance.length,
        "no source lost at month boundary",
      );
      for (const row of w.attendance) {
        const source = own.find((r: any) => r.attendanceId === row.id);
        assert(source, w.ledger.key + " source " + row.id);
        assert.equal(
          source.snapshot.startsAt,
          new Date(row.interval.start).toISOString(),
        );
        assert.equal(
          source.snapshot.endsAt,
          new Date(row.interval.end).toISOString(),
        );
        const t = intervalTotals(
          [row.interval],
          row.interval.start,
          row.interval.end,
        );
        assert.equal(source.totals.workedMs, t.net);
        assert.equal(source.totals.presenceMs, t.presence);
        assert.equal(source.totals.paidBreakMs, t.paid);
        assert.equal(source.totals.unpaidBreakMs, t.unpaid);
      }
      for (let day = "2031-03-01"; day < "2031-04-01"; day = dayAdd(day, 1)) {
        const lo = instant(day + "T00:00"),
          hi = instant(dayAdd(day, 1) + "T00:00"),
          expectedDay = intervalTotals(w.ledger.actual, lo, hi);
        const observed = intervalTotals(
          own.map((r: any) => ({
            start: Date.parse(r.snapshot.startsAt),
            end: Date.parse(r.snapshot.endsAt),
            breaks: r.snapshot.breaks.map((x: any) => ({
              start: Date.parse(x.startsAt),
              end: Date.parse(x.endsAt),
              kind: x.kind,
            })),
            source: r.attendanceId,
          })),
          lo,
          hi,
        );
        assert.deepEqual(
          observed,
          expectedDay,
          w.ledger.key + " " + day + " source allocation",
        );
        daily.push({
          tenantId: b.owner.tenantId,
          venueId: b.owner.venueId,
          worker: w.ledger.key,
          date: day,
          expected: expectedDay,
          observed,
          sourceIds: own
            .filter(
              (r: any) =>
                Date.parse(r.snapshot.startsAt) < hi &&
                Date.parse(r.snapshot.endsAt) > lo,
            )
            .map((r: any) => r.attendanceId),
          targetMinutes: targetMinutes(w.ledger, day, b.config),
          discrepancies: [],
        });
      }
      if (!browser || i >= 4) {
        const closed = await api(
          b.managers[0]!,
          "monthly-account/" + w.actor.membershipId + "/close?month=2031-03",
          {
            idempotencyKey: key(),
            expectedFingerprint: data.fingerprint,
            reason: "Independent WF4 input ledger and source reconciliation",
            reviewConfirmed: true,
          },
        );
        assert.equal(closed.closing.version, 1);
        assert.deepEqual(closed.closing.original.totals, expected);
        counts.closes++;
      }
    }
    const stats = await api(b.owner, "monthly-statistics?month=2031-03");
    assert.equal(stats.laborToSales.status, "NOT_CONFIGURED");
    for (const station of b.config.stations) {
      const plans = b.plans.filter(
          (p) => !p.cancelled && p.station === station,
        ),
        expectedPresence = plans.reduce(
          (n, p) =>
            n +
            Math.max(
              0,
              Math.min(p.end, instant("2031-04-01T00:00")) -
                Math.max(p.start, instant("2031-03-01T00:00")),
            ),
          0,
        );
      const row = stats.stations.find((s: any) => s.station === station);
      assert.equal(
        row.publishedPresenceMs,
        expectedPresence,
        b.config.country + " coverage " + station,
      );
    }
    counts.plannedShifts += b.plans.filter((p) => !p.cancelled).length;
  }
  for (const b of businesses)
    for (const [i, manager] of b.managers.entries()) {
      const ledger: LedgerWorker = {
        key: b.config.country + "-manager-" + i,
        contracts: [{ from: "2031-02-01", weeklyMinutes: b.config.weekly[0]! }],
        planned: [],
        actual: [],
        leave: [],
        carryMinutes: b.config.carry,
      };
      const data = await api(
        b.managers[1 - i]!,
        "monthly-account?month=2031-03&membershipId=" + manager.membershipId,
      );
      reports.push(
        reconcile(
          data.account.totals,
          expectedMonth(ledger, b.config),
          ledger.key + " confirmed empty attendance account",
        ),
      );
      const closed = await api(
        b.managers[1 - i]!,
        "monthly-account/" + manager.membershipId + "/close?month=2031-03",
        {
          idempotencyKey: key(),
          expectedFingerprint: data.fingerprint,
          reason:
            "Independent manager contract and complete zero-activity source review",
          reviewConfirmed: true,
        },
      );
      assert.equal(closed.closing.version, 1);
      counts.closes++;
    }
  // A later close must retain its original carry while earlier corrections append compensation.
  clock.now = instant("2031-05-02T09:00");
  for (const b of businesses) {
    const w = b.workers[4]!,
      march = await api(
        b.managers[0]!,
        "monthly-account?month=2031-03&membershipId=" + w.actor.membershipId,
      );
    const expectedMarch = expectedMonth(w.ledger, b.config);
    reports.push(
      reconcile(
        march.account.totals,
        expectedMarch,
        w.ledger.key + " March before carry",
      ),
    );
    assert.deepEqual(march.closing.original.totals, expectedMarch);
    const frozen = structuredClone(march.closing.original);
    const april = await api(
      b.managers[0]!,
      "monthly-account?month=2031-04&membershipId=" + w.actor.membershipId,
    );
    const expectedApril = expectedFollowingMonth(
      w.ledger,
      b.config,
      "2031-03",
      "2031-04",
      { positiveMinutes: null, negativeMinutes: null },
    );
    reports.push(
      reconcile(
        april.account.totals,
        expectedApril,
        w.ledger.key + " April carry",
      ),
    );
    const aprilClosed = await api(
      b.managers[0]!,
      "monthly-account/" + w.actor.membershipId + "/close?month=2031-04",
      {
        idempotencyKey: key(),
        expectedFingerprint: april.fingerprint,
        reason: "Independent carry and next-period boundary review",
        reviewConfirmed: true,
      },
    );
    assert.deepEqual(aprilClosed.closing.original.totals, expectedApril);
    counts.closes++;
    const row =
      w.attendance.find((x) => x.localStart.startsWith("2031-03-28")) ??
      w.attendance.find((x) => x.localStart.startsWith("2031-03-27"))!;
    assert(row);
    const beforeEvents = await prisma.workforceAttendanceEvent.findMany({
      where: { attendanceId: row.id },
      orderBy: { sequence: "asc" },
    });
    const digest = createHash("sha256")
      .update(JSON.stringify(beforeEvents))
      .digest("hex");
    const end = new Date(Date.parse(row.localEnd + "Z") + 15 * 60000)
      .toISOString()
      .slice(0, 16);
    const local = (ms: number) =>
      new Date(ms + 3600000).toISOString().slice(0, 16);
    const r = await api(w.actor, "corrections", {
      idempotencyKey: key(),
      attendanceId: row.id,
      expectedAttendanceVersion: row.version,
      reason: "INTERVAL",
      startsLocal: row.localStart,
      endsLocal: end,
      breaks: row.interval.breaks.map((x) => ({
        startsLocal: local(x.start),
        endsLocal: local(x.end),
        kind: x.kind,
      })),
    });
    await decide(b, r.id);
    row.interval.end += 15 * 60000;
    const updated = await api(
      b.managers[0]!,
      "monthly-account?month=2031-03&membershipId=" + w.actor.membershipId,
    );
    assert.deepEqual(updated.closing.original, frozen);
    reports.push(
      reconcile(
        updated.account.totals,
        expectedMonth(w.ledger, b.config),
        w.ledger.key + " post-close adjustment",
      ),
    );
    assert.equal(updated.adjustments.length, 1);
    const chained = await api(
      b.managers[0]!,
      "monthly-account?month=2031-04&membershipId=" + w.actor.membershipId,
    );
    assert.deepEqual(chained.closing.original, aprilClosed.closing.original);
    const correctedApril = expectedFollowingMonth(
      w.ledger,
      b.config,
      "2031-03",
      "2031-04",
      { positiveMinutes: null, negativeMinutes: null },
    );
    reports.push(
      reconcile(
        chained.account.totals,
        correctedApril,
        w.ledger.key + " April compensated carry",
      ),
    );
    assert.equal(correctedApril.carryMs - expectedApril.carryMs, 15 * 60000);
    assert.equal(
      correctedApril.balanceMs - expectedApril.balanceMs,
      15 * 60000,
    );
    assert.equal(chained.adjustments.length, 1);
    assert.deepEqual(
      chained.adjustments[0].delta,
      Object.fromEntries(
        Object.entries(correctedApril).map(([metric, value]) => [
          metric,
          value - expectedApril[metric as keyof typeof expectedApril],
        ]),
      ),
    );
    counts.adjustments += 2;
    const unchanged = (
      await prisma.workforceAttendanceEvent.findMany({
        where: { attendanceId: row.id },
        orderBy: { sequence: "asc" },
      })
    ).filter((x) => x.kind !== "CORRECTION");
    assert.equal(
      createHash("sha256").update(JSON.stringify(unchanged)).digest("hex"),
      digest,
    );
    const leave = b.workers[5]!,
      leaveId = b.leaves.get("5")!;
    await decide(b, leaveId, "CANCEL_APPROVED", 1);
    leave.ledger.leave[0]!.status = "CANCELLED";
    const cancelled = await api(
      b.managers[0]!,
      "monthly-account?month=2031-03&membershipId=" + leave.actor.membershipId,
    );
    reports.push(
      reconcile(
        cancelled.account.totals,
        expectedMonth(leave.ledger, b.config),
        leave.ledger.key + " post-close leave cancellation",
      ),
    );
    assert.equal(cancelled.adjustments.length, 1);
    counts.adjustments++;
    const bank = await api(
      b.owner,
      "leave-allowance/" + leave.actor.membershipId + "?year=2031",
    );
    assert.equal(bank.remainingMinutes, 4800);
  }
  checks.push(
    "immutable original close; source-only compensation; closed carry chain; leave allowance restored",
  );
  // Replay preserves exactly the original recipient/channel set. Disabled service never becomes delivered.
  for (const b of businesses) {
    const n = await prisma.workforceNotification.count({
        where: { tenantId: b.owner.tenantId },
      }),
      d = await prisma.workforceNotificationDelivery.count({
        where: { tenantId: b.owner.tenantId },
      });
    await workforceNotificationOutbox.replayIntents(b.owner);
    await workforceNotificationOutbox.replayIntents(b.owner);
    assert.equal(
      await prisma.workforceNotification.count({
        where: { tenantId: b.owner.tenantId },
      }),
      n,
    );
    assert.equal(
      await prisma.workforceNotificationDelivery.count({
        where: { tenantId: b.owner.tenantId },
      }),
      d,
    );
  }
  const disabled = createWorkforceNotificationWorker({
    emailService: disabledTransactionalNotificationService,
    emailProvider: "disabled",
    clock: () => new Date(clock.now),
  });
  await disabled.runOnce(100);
  assert.equal(
    await prisma.workforceNotificationDelivery.count({
      where: { state: "DELIVERED" },
    }),
    0,
  );
  for (const b of businesses) {
    for (const w of b.workers.filter((w) => !w.ledger.endedOn)) {
      const n = await api(w.actor, "notifications?locale=en");
      assert(
        n.items.every(
          (item: any) =>
            !JSON.stringify(item).includes(
              businesses.find((x) => x !== b)!.owner.tenantId,
            ),
        ),
      );
      const important = n.items.find((item: any) => item.important);
      if (important) {
        await api(w.actor, "notifications/" + important.id + "/read", {});
        await api(
          w.actor,
          "notifications/" + important.id + "/acknowledgment",
          { reviewConfirmed: true },
        );
      }
    }
  }
  checks.push(
    "inbox isolation; read and acknowledgment; scoped replay/dedup; disabled never delivered",
  );
  const edgeEvidence = await runEdgeScenarios({
    app,
    clock,
    businesses,
    api,
    response,
    checks,
  });
  if (browser) {
    const weeks = [
      "2031-11-03",
      "2031-11-10",
      "2031-11-17",
      "2031-11-24",
      "2031-12-01",
      "2031-12-08",
      "2031-12-15",
      "2031-12-22",
    ];
    for (const [bi, b] of businesses.entries())
      for (let locale = 0; locale < 4; locale++) {
        const week = weeks[locale * 2 + bi]!;
        addPlan(b, locale, week, "09:00", 480);
        addPlan(b, locale, dayAdd(week, 2), "09:00", 480);
        addPlan(b, (locale + 1) % 4, dayAdd(week, 4), "09:00", 480);
        await publish(b, week);
      }
  }
  const manifest = {
    schemaVersion: 1,
    runId: url.searchParams.get("schema"),
    base: "871e4a39ef1e6365539a9fc07b03fd5c21df9327",
    month: "2031-03",
    daysPerBusiness: 31,
    counts,
    checks,
    status: "passed",
    discrepancies: 0,
    browserPending: browser,
    businesses: businesses.map((b) => ({
      name: b.config.name,
      country: b.config.country,
      currency: b.config.currency,
      timezone: b.config.timezone,
      tenantId: b.owner.tenantId,
      venueId: b.owner.venueId,
      workers: b.workers.map((w) => ({
        key: w.ledger.key,
        membershipId: w.actor.membershipId,
        contracts: w.ledger.contracts,
        endedOn: w.ledger.endedOn,
        expected: expectedMonth(w.ledger, b.config),
      })),
    })),
    notificationCount: await prisma.workforceNotification.count(),
    deliveryCount: await prisma.workforceNotificationDelivery.count(),
    primaryElapsedMs: Date.now() - started,
    edgeCases: edgeEvidence.length,
    databaseTotals: {
      tenants: await prisma.tenant.count(),
      venues: await prisma.venue.count(),
      contracts: await prisma.staffEmploymentContract.count(),
      attendance: await prisma.workforceAttendance.count(),
      attendanceEvents: await prisma.workforceAttendanceEvent.count(),
      approvals: await prisma.workforceAttendanceApproval.count(),
      requests: await prisma.workforceRequest.count(),
      closes: await prisma.workforceMonthlyClose.count(),
      adjustments: await prisma.workforceMonthlyAdjustment.count(),
    },
  };
  await writeFile(root + "/manifest.json", JSON.stringify(manifest, null, 2));
  await writeFile(
    root + "/daily-reconciliation.json",
    JSON.stringify(daily, null, 2),
  );
  await writeFile(
    root + "/monthly-report.json",
    JSON.stringify(reports, null, 2),
  );
  await writeFile(root + "/event-log.json", JSON.stringify(log, null, 2));
  // This private fixture file is ignored and never uploaded; public evidence has no passwords/cookies.
  await writeFile(
    root + "/actors.json",
    JSON.stringify(
      businesses.map((b) => ({
        country: b.config.country,
        owner: b.owner,
        manager: b.managers[0],
        manager2: b.managers[1],
        workers: b.workers.map((w) => w.actor),
      })),
      null,
      2,
    ),
  );
  return { manifest, businesses, clock, api, response };
}
