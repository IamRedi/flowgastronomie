import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { buildApp } from "./app.js";
import { prisma } from "@flowgastronomie/database";
import {
  workforceDefaultRules,
  type WorkforceAssignment,
} from "@flowgastronomie/domain";
import { workforceFixture } from "../../../tests/workforce/fixtures.js";
let now = new Date("2030-08-12T07:00:00Z");
const app = buildApp({}, { workforceClock: () => new Date(now) });
const prefix = "/v1/staff/workforce/";
const send = (
  cookie: string,
  path: string,
  payload?: unknown,
  method = payload ? "POST" : "GET",
) =>
  app.inject({
    method: method as "GET" | "POST" | "PUT",
    url: prefix + path,
    headers: { cookie },
    ...(payload ? { payload: payload as Record<string, unknown> } : {}),
  });
const key = () => randomUUID();
const advance = (value: string) => {
  now = new Date(value);
};
let de: Awaited<ReturnType<typeof workforceFixture>>, al: typeof de;
type Employee = Awaited<ReturnType<typeof de.addEmployee>>;
let worker: Employee,
  partner: Employee,
  unqualified: Employee,
  recovery: Employee,
  manager: Employee,
  manager2: Employee,
  secondCookie: string,
  secondVenueId: string;
let attendanceId: string,
  attendanceVersion = 0,
  originalEvents: string;
const shifts: WorkforceAssignment[] = [];
function shift(
  member: string | null,
  day: string,
  start = "09:00",
  end = "17:00",
): WorkforceAssignment {
  return {
    id: key(),
    membershipId: member,
    station: "KITCHEN",
    startsLocal: day + "T" + start,
    endsLocal: day + "T" + end,
    startChoice: "reject",
    endChoice: "reject",
    breakMinutes: 30,
    requiredSkills: ["Food safety"],
    note: "Synthetic operational schedule",
  };
}
const ops = async (cookie: string, from = "2030-08-12", to = "2030-08-31") => {
  const r = await send(cookie, "operations?from=" + from + "&to=" + to);
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
};
async function configureEmployee(
  e: Employee,
  skills = ["Food safety"],
  stations = ["KITCHEN"],
) {
  let r = await send(
    de.owner.cookie,
    "profiles/" + e.membershipId,
    { expectedVersion: 0, stations, skills },
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
    terms: "PRIVATE CONTRACT TEXT",
  });
  expect(r.statusCode, r.body).toBe(200);
}
const decide = (
  cookie: string,
  id: string,
  action: string,
  version = 0,
  extra = {},
) =>
  send(cookie, "requests/" + id + "/decision", {
    expectedVersion: version,
    action,
    reason: "Operational review completed",
    reviewConfirmed: true,
    warningsAcknowledged: true,
    ...extra,
  });
const punch = (
  cookie: string,
  kind: string,
  version: number,
  idempotencyKey = key(),
  extra = {},
) =>
  send(cookie, "attendance/punch", {
    kind,
    expectedVersion: version,
    idempotencyKey,
    ...extra,
  });
describe
  .skipIf(process.env.WORKFORCE_WF2_DB_GATE !== "true")
  .sequential("WF2 real PostgreSQL + authenticated API", () => {
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (
        !/^workforce_wf2_gate_\d+$/.test(url.searchParams.get("schema") ?? "")
      )
        throw new Error("Isolated WF2 schema required");
      de = await workforceFixture(app, "DE");
      al = await workforceFixture(app, "AL");
      worker = await de.addEmployee("Synthetic Clock Worker");
      partner = await de.addEmployee("Synthetic Qualified Coworker");
      unqualified = await de.addEmployee("Synthetic Bar Worker", "BAR");
      recovery = await de.addEmployee("Synthetic Recovery Worker");
      manager = await de.addEmployee("Synthetic Manager One", "MANAGER");
      manager2 = await de.addEmployee("Synthetic Manager Two", "MANAGER");
      for (const e of [worker, partner, recovery, manager, manager2])
        await configureEmployee(e);
      await configureEmployee(unqualified, [], ["BAR"]);
      let r = await send(de.owner.cookie, "policy", {
        expectedVersion: 0,
        effectiveFrom: "2030-01-01",
        countryCode: "DE",
        rules: { ...workforceDefaultRules("DE"), paidBreaksAllowed: true },
        reason: "Synthetic contract and jurisdiction review",
      });
      expect(r.statusCode, r.body).toBe(200);
      shifts.push(
        shift(worker.membershipId, "2030-08-12"),
        shift(worker.membershipId, "2030-08-15"),
        shift(partner.membershipId, "2030-08-16"),
        shift(null, "2030-08-14"),
        shift(worker.membershipId, "2030-08-17"),
      );
      r = await send(
        de.owner.cookie,
        "schedule",
        {
          week: "2030-08-12",
          expectedVersion: 0,
          status: "PUBLISHED",
          reviewConfirmed: true,
          assignments: shifts,
        },
        "PUT",
      );
      expect(r.statusCode, r.body).toBe(200);
      const venue = await prisma.venue.create({
        data: {
          tenantId: de.owner.tenantId,
          name: "Synthetic Second Venue",
          slug: "second-" + key(),
          timezone: "Europe/Berlin",
          countryCode: "DE",
          currency: "EUR",
        },
      });
      secondVenueId = venue.id;
      const m = await prisma.membership.create({
        data: {
          tenantId: de.owner.tenantId,
          venueId: venue.id,
          userId: worker.userId,
          role: "WAITER",
        },
      });
      await prisma.staffProfile.create({
        data: {
          tenantId: de.owner.tenantId,
          venueId: venue.id,
          userId: worker.userId,
          membershipId: m.id,
        },
      });
      const login = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          tenantSlug: de.owner.tenantSlug,
          venueSlug: venue.slug,
          email: worker.email,
          password: worker.password,
        },
      });
      expect(login.statusCode, login.body).toBe(200);
      secondCookie = login.cookies
        .map((c) => c.name + "=" + c.value)
        .join("; ");
    }, 30000);
    afterAll(async () => {
      await app.close();
      await prisma.$disconnect();
    });
    it("uses fresh registered businesses, canonical profiles and strict clock transport", async () => {
      expect(de.owner.tenantId).not.toBe(al.owner.tenantId);
      expect((await ops(worker.cookie)).attendance).toEqual([]);
      expect(
        (
          await send(worker.cookie, "attendance/punch", {
            kind: "CLOCK_IN",
            expectedVersion: 0,
            idempotencyKey: key(),
            occurredAt: "2000-01-01T00:00Z",
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (await send(worker.cookie, "policy", { expectedVersion: 0 }))
          .statusCode,
      ).toBe(403);
    });
    it("employee JSON discloses only self and eligible open shifts; exchange catalog requires an owned future shift", async () => {
      const w = await ops(worker.cookie);
      expect(w.roster.map((m: { userId: string }) => m.userId)).toEqual([
        worker.userId,
      ]);
      expect(
        w.shifts.every(
          (x: { userId: string | null }) =>
            x.userId === worker.userId || x.userId === null,
        ),
      ).toBe(true);
      expect(JSON.stringify(w)).not.toContain(partner.membershipId);
      expect((await ops(unqualified.cookie)).shifts).toEqual([]);
      const catalog = await send(
        worker.cookie,
        "exchange-options?assignmentId=" + shifts[1]!.id,
      );
      expect(catalog.statusCode, catalog.body).toBe(200);
      expect(catalog.json().shifts).toEqual([]);
      expect(
        catalog
          .json()
          .roster.some(
            (m: { membershipId: string }) =>
              m.membershipId === partner.membershipId,
          ),
      ).toBe(true);
      expect(
        catalog
          .json()
          .roster.some(
            (m: { membershipId: string }) =>
              m.membershipId === unqualified.membershipId,
          ),
      ).toBe(false);
      expect(catalog.body).not.toContain("PRIVATE CONTRACT TEXT");
      expect(catalog.body).not.toContain("userId");
      for (const cookie of [worker.cookie, al.owner.cookie, secondCookie]) {
        const forbidden = await send(
          cookie,
          "exchange-options?assignmentId=" + shifts[2]!.id,
        );
        expect(forbidden.statusCode, forbidden.body).toBe(404);
      }
      expect(
        (await send(worker.cookie, "profiles/" + partner.membershipId))
          .statusCode,
      ).toBe(403);
      const profile = await send(
        manager.cookie,
        "profiles/" + partner.membershipId,
      );
      expect(profile.statusCode, profile.body).toBe(200);
      expect(profile.body).not.toContain("PRIVATE CONTRACT TEXT");
      expect(profile.json()).not.toHaveProperty("contracts");
      const privateProfile = await send(
        de.owner.cookie,
        "profiles/" + partner.membershipId,
      );
      expect(privateProfile.statusCode, privateProfile.body).toBe(200);
      expect(privateProfile.body).toContain("PRIVATE CONTRACT TEXT");
      const m = await ops(manager.cookie);
      expect(
        m.roster.some((x: { userId: string }) => x.userId === partner.userId),
      ).toBe(true);
      expect(m.balances).toEqual([]);
      expect(JSON.stringify(m)).not.toContain("PRIVATE CONTRACT TEXT");
      for (const cookie of [
        worker.cookie,
        manager.cookie,
        al.owner.cookie,
        secondCookie,
      ]) {
        const forbidden = await send(
          cookie,
          "leave-allowance/" + partner.membershipId + "?year=2030",
        );
        expect([403, 404]).toContain(forbidden.statusCode);
      }
      expect(
        (
          await send(
            de.owner.cookie,
            "leave-allowance/" + partner.membershipId + "?year=2030",
          )
        ).statusCode,
      ).toBe(200);
    });
    it("clock-in is server authoritative and identical retries create one immutable event", async () => {
      const retryKey = key(),
        body = {
          kind: "CLOCK_IN",
          expectedVersion: 0,
          idempotencyKey: retryKey,
        };
      const results = await Promise.all([
        send(worker.cookie, "attendance/punch", body),
        send(worker.cookie, "attendance/punch", body),
      ]);
      results.forEach((r) => expect(r.statusCode, r.body).toBe(200));
      expect(results[0]!.json()).toEqual(results[1]!.json());
      attendanceId = results[0]!.json().attendanceId;
      attendanceVersion = 1;
      expect(results[0]!.json().occurredAt).toBe(now.toISOString());
      expect(
        await prisma.workforceAttendanceEvent.count({
          where: { attendanceId },
        }),
      ).toBe(1);
      expect((await punch(worker.cookie, "CLOCK_IN", 1)).statusCode).toBe(409);
      expect(
        (
          await send(worker.cookie, "attendance/punch", {
            ...body,
            kind: "CLOCK_OUT",
          })
        ).statusCode,
      ).toBe(409);
    });
    it("prevents concurrent active work across venues and isolates venue/tenant reads", async () => {
      expect((await punch(secondCookie, "CLOCK_IN", 0)).statusCode).toBe(409);
      expect(
        (
          await send(
            al.owner.cookie,
            "attendance/" + attendanceId + "/approval",
            {
              expectedVersion: 1,
              reason: "Synthetic scope check",
              reviewConfirmed: true,
              warningsAcknowledged: true,
            },
          )
        ).statusCode,
      ).toBe(404);
      expect((await ops(secondCookie)).attendance).toEqual([]);
      expect((await ops(secondCookie)).activeElsewhere.venueId).toBe(
        worker.venueId,
      );
      expect((await ops(unqualified.cookie)).attendance).toEqual([]);
    });
    it("tracks two actual unpaid breaks, blocks unresolved-break clock out, and reconciles 480/30/450", async () => {
      advance("2030-08-12T10:00Z");
      expect((await punch(worker.cookie, "BREAK_START", 1)).statusCode).toBe(
        200,
      );
      expect((await punch(worker.cookie, "BREAK_START", 2)).statusCode).toBe(
        409,
      );
      expect((await punch(worker.cookie, "CLOCK_OUT", 2)).statusCode).toBe(409);
      advance("2030-08-12T10:15Z");
      expect((await punch(worker.cookie, "BREAK_END", 2)).statusCode).toBe(200);
      advance("2030-08-12T12:00Z");
      expect((await punch(worker.cookie, "BREAK_START", 3)).statusCode).toBe(
        200,
      );
      advance("2030-08-12T12:15Z");
      expect((await punch(worker.cookie, "BREAK_END", 4)).statusCode).toBe(200);
      advance("2030-08-12T15:00Z");
      const r = await punch(worker.cookie, "CLOCK_OUT", 5);
      expect(r.statusCode, r.body).toBe(200);
      attendanceVersion = 6;
      const view = (await ops(worker.cookie)).attendance[0];
      expect(view.totals).toMatchObject({
        presenceMinutes: 480,
        breakMinutes: 30,
        workedMinutes: 450,
      });
      expect(view.original.breaks).toHaveLength(2);
      expect(view.approved).toBeNull();
      originalEvents = JSON.stringify(
        await prisma.workforceAttendanceEvent.findMany({
          where: { attendanceId },
          orderBy: { sequence: "asc" },
        }),
      );
    });
    it("independent two-manager approval commits once and preserves the approved source calculation", async () => {
      const body = {
        expectedVersion: attendanceVersion,
        reason: "Reviewed original work evidence",
        reviewConfirmed: true,
        warningsAcknowledged: true,
      };
      expect(
        (
          await send(
            worker.cookie,
            "attendance/" + attendanceId + "/approval",
            body,
          )
        ).statusCode,
      ).toBe(403);
      const results = await Promise.all([
        send(manager.cookie, "attendance/" + attendanceId + "/approval", body),
        send(manager2.cookie, "attendance/" + attendanceId + "/approval", body),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const a = (await ops(worker.cookie)).attendance[0];
      expect(a.approved.totals.workedMinutes).toBe(450);
      expect(a.approved.sourceEventIds).toHaveLength(6);
    });
    it("approved correction appends compensation and retains every original timestamp + prior approval", async () => {
      advance("2030-08-12T16:00Z");
      const request = await send(worker.cookie, "corrections", {
        idempotencyKey: key(),
        attendanceId,
        expectedAttendanceVersion: 6,
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
      expect(request.statusCode, request.body).toBe(200);
      const r = await decide(manager.cookie, request.json().id, "APPROVE");
      expect(r.statusCode, r.body).toBe(200);
      const view = (await ops(worker.cookie)).attendance[0];
      expect(view.totals.workedMinutes).toBe(480);
      expect(view.approved.totals.workedMinutes).toBe(480);
      expect(view.approvalHistory).toHaveLength(2);
      expect(view.events.at(-1).kind).toBe("CORRECTION");
      expect(
        JSON.stringify(
          await prisma.workforceAttendanceEvent.findMany({
            where: { attendanceId, kind: { not: "CORRECTION" } },
            orderBy: { sequence: "asc" },
          }),
        ),
      ).toBe(originalEvents);
      expect(view.original.endsAt).toBe("2030-08-12T15:00:00.000Z");
      const sources = await send(
        worker.cookie,
        "approved-hours?from=2030-08-12&to=2030-08-18",
      );
      expect(sources.statusCode, sources.body).toBe(200);
      expect(sources.json().records[0]).toMatchObject({
        schemaVersion: 1,
        attendanceId,
        tenantId: worker.tenantId,
        venueId: worker.venueId,
        userId: worker.userId,
        membershipId: worker.membershipId,
        timezone: "Europe/Berlin",
        totals: { workedMinutes: 480 },
      });
      expect(sources.json().records[0].sourceEventIds).toHaveLength(7);
      expect(sources.json().records[0].correctionRequestId).toBe(
        request.json().id,
      );
      expect(
        (
          await send(
            unqualified.cookie,
            "approved-hours?from=2030-08-12&to=2030-08-18",
          )
        ).json().records,
      ).toEqual([]);
    });
    it("recovers an interrupted session and forgotten clock-out without altering original break evidence", async () => {
      advance("2030-08-12T17:00Z");
      expect((await punch(recovery.cookie, "CLOCK_IN", 0)).statusCode).toBe(
        200,
      );
      advance("2030-08-12T18:00Z");
      expect((await punch(recovery.cookie, "BREAK_START", 1)).statusCode).toBe(
        200,
      );
      advance("2030-08-13T10:00Z");
      let view = (await ops(recovery.cookie)).current;
      expect((await ops(recovery.cookie)).warnings[0].codes).toContain(
        "MISSING_OUT",
      );
      const req = await send(recovery.cookie, "corrections", {
        idempotencyKey: key(),
        attendanceId: view.id,
        expectedAttendanceVersion: 2,
        reason: "MISSING_OUT",
        startsLocal: "2030-08-12T19:00",
        endsLocal: "2030-08-12T23:00",
        breaks: [
          {
            startsLocal: "2030-08-12T20:00",
            endsLocal: "2030-08-12T20:15",
            kind: "UNPAID",
          },
        ],
      });
      expect(req.statusCode, req.body).toBe(200);
      expect(
        (await decide(manager.cookie, req.json().id, "APPROVE")).statusCode,
      ).toBe(200);
      view = (await ops(recovery.cookie)).attendance[0];
      expect(view.state).toBe("CLOSED");
      expect(view.approved.totals.workedMinutes).toBe(225);
      expect(view.events.map((e: { kind: string }) => e.kind)).toEqual([
        "CLOCK_IN",
        "BREAK_START",
        "CORRECTION",
      ]);
    });
    it("supports paid/unpaid evidence and explicitly reviewed unscheduled work", async () => {
      advance("2030-08-13T10:00Z");
      let r = await punch(partner.cookie, "CLOCK_IN", 0);
      expect(r.statusCode, r.body).toBe(200);
      advance("2030-08-13T11:00Z");
      expect(
        (
          await punch(partner.cookie, "BREAK_START", 1, key(), {
            breakKind: "PAID",
          })
        ).statusCode,
      ).toBe(200);
      advance("2030-08-13T11:15Z");
      expect((await punch(partner.cookie, "BREAK_END", 2)).statusCode).toBe(
        200,
      );
      advance("2030-08-13T12:00Z");
      expect((await punch(partner.cookie, "CLOCK_OUT", 3)).statusCode).toBe(
        200,
      );
      const view = (await ops(partner.cookie)).attendance[0];
      expect(view.totals).toMatchObject({
        presenceMinutes: 120,
        breakMinutes: 15,
        paidBreakMinutes: 15,
        workedMinutes: 120,
      });
      expect((await ops(partner.cookie)).warnings[0].codes).toContain(
        "UNSCHEDULED",
      );
      expect(
        (
          await send(manager.cookie, "attendance/" + view.id + "/approval", {
            expectedVersion: 4,
            reason: "Reviewed unscheduled work",
            reviewConfirmed: true,
            warningsAcknowledged: false,
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await send(manager.cookie, "attendance/" + view.id + "/approval", {
            expectedVersion: 4,
            reason: "Reviewed unscheduled work",
            reviewConfirmed: true,
            warningsAcknowledged: true,
          })
        ).statusCode,
      ).toBe(200);
    });
    it("records missed clock-in as a proposal with no invented original punch, and rejects overlapping corrected work", async () => {
      const req = await send(unqualified.cookie, "corrections", {
        idempotencyKey: key(),
        attendanceId: null,
        expectedAttendanceVersion: 0,
        reason: "MISSING_IN",
        startsLocal: "2030-08-13T09:00",
        endsLocal: "2030-08-13T10:00",
        breaks: [],
      });
      expect(req.statusCode, req.body).toBe(200);
      const result = await decide(manager.cookie, req.json().id, "APPROVE");
      expect(result.statusCode, result.body).toBe(200);
      const view = (await ops(unqualified.cookie)).attendance[0];
      expect(view.original).toBeNull();
      expect(view.events.map((e: { kind: string }) => e.kind)).toEqual([
        "CORRECTION",
      ]);
      expect(view.approved.totals.workedMinutes).toBe(60);
      const overlapping = await send(unqualified.cookie, "corrections", {
        idempotencyKey: key(),
        attendanceId: null,
        expectedAttendanceVersion: 0,
        reason: "MISSING_IN",
        startsLocal: "2030-08-13T09:30",
        endsLocal: "2030-08-13T10:30",
        breaks: [],
      });
      expect(overlapping.statusCode).toBe(200);
      expect(
        (await decide(manager.cookie, overlapping.json().id, "APPROVE"))
          .statusCode,
      ).toBe(409);
    });
    it("a manager cannot approve their own actual attendance", async () => {
      advance("2030-08-13T13:00Z");
      expect((await punch(manager.cookie, "CLOCK_IN", 0)).statusCode).toBe(200);
      advance("2030-08-13T14:00Z");
      expect((await punch(manager.cookie, "CLOCK_OUT", 1)).statusCode).toBe(
        200,
      );
      const view = (await ops(manager.cookie)).attendance.find(
        (a: { userId: string }) => a.userId === manager.userId,
      );
      const body = {
        expectedVersion: 2,
        reason: "Independent review required",
        reviewConfirmed: true,
        warningsAcknowledged: true,
      };
      expect(
        (
          await send(
            manager.cookie,
            "attendance/" + view.id + "/approval",
            body,
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await send(
            manager2.cookie,
            "attendance/" + view.id + "/approval",
            body,
          )
        ).statusCode,
      ).toBe(200);
    });
    it("explicitly links POS evidence without treating an operational session as attendance or ending it on clock-out", async () => {
      const before = await prisma.workforceAttendance.count({
        where: { userId: worker.userId },
      });
      const pos = await app.inject({
        method: "POST",
        url: "/v1/staff/shift/start",
        headers: { cookie: worker.cookie },
        payload: {},
      });
      expect(pos.statusCode, pos.body).toBe(200);
      expect(
        await prisma.workforceAttendance.count({
          where: { userId: worker.userId },
        }),
      ).toBe(before);
      const operationalId = pos.json().id;
      advance("2030-08-13T15:00Z");
      let r = await punch(worker.cookie, "CLOCK_IN", 0, key(), {
        operationalStaffShiftId: operationalId,
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(
        (
          await prisma.workforceAttendance.findUniqueOrThrow({
            where: { id: r.json().attendanceId },
          })
        ).operationalStaffShiftId,
      ).toBe(operationalId);
      advance("2030-08-13T16:00Z");
      expect((await punch(worker.cookie, "CLOCK_OUT", 1)).statusCode).toBe(200);
      expect(
        (
          await prisma.staffShift.findUniqueOrThrow({
            where: { id: operationalId },
          })
        ).status,
      ).toBe("OPEN");
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/staff/shift/end",
            headers: { cookie: worker.cookie },
            payload: {},
          })
        ).statusCode,
      ).toBe(200);
    });
    it("partial annual leave uses an explicit auditable allowance, staffing review and immutable decisions", async () => {
      const grant = {
        membershipId: worker.membershipId,
        year: 2030,
        minutes: 4800,
        expectedVersion: 0,
        reason: "Explicit synthetic annual allowance, no carryover",
        idempotencyKey: key(),
      };
      expect(
        (await send(manager.cookie, "leave-allowance", grant)).statusCode,
      ).toBe(403);
      let r = await send(de.owner.cookie, "leave-allowance", grant);
      expect(r.statusCode, r.body).toBe(200);
      expect(
        (await send(de.owner.cookie, "leave-allowance", grant)).json()
          .allowanceMinutes,
      ).toBe(4800);
      const next = shift(worker.membershipId, "2030-08-20");
      r = await send(
        de.owner.cookie,
        "schedule",
        {
          week: "2030-08-19",
          expectedVersion: 0,
          status: "PUBLISHED",
          reviewConfirmed: true,
          assignments: [next],
        },
        "PUT",
      );
      expect(r.statusCode, r.body).toBe(200);
      const leave = {
        idempotencyKey: key(),
        category: "ANNUAL",
        from: "2030-08-20",
        to: "2030-08-20",
        partial: {
          startsLocal: "2030-08-20T09:00",
          endsLocal: "2030-08-20T11:00",
        },
      };
      r = await send(worker.cookie, "leave", leave);
      expect(r.statusCode, r.body).toBe(200);
      const id = r.json().id;
      expect((await send(worker.cookie, "leave", leave)).json().id).toBe(id);
      expect(
        (
          await decide(manager.cookie, id, "APPROVE", 0, {
            warningsAcknowledged: false,
          })
        ).statusCode,
      ).toBe(400);
      expect((await decide(manager.cookie, id, "APPROVE")).statusCode).toBe(
        200,
      );
      expect((await ops(worker.cookie)).balance).toMatchObject({
        allowanceMinutes: 4800,
        usedMinutes: 120,
        remainingMinutes: 4680,
      });
      expect((await decide(worker.cookie, id, "WITHDRAW", 1)).statusCode).toBe(
        409,
      );
      expect(
        (await decide(manager2.cookie, id, "CANCEL_APPROVED", 1)).statusCode,
      ).toBe(200);
      expect((await ops(worker.cookie)).balance.usedMinutes).toBe(0);
      expect(
        await prisma.workforceRequestTransition.count({
          where: { requestId: id },
        }),
      ).toBe(3);
      const large = await send(worker.cookie, "leave", {
        idempotencyKey: key(),
        category: "ANNUAL",
        from: "2030-08-26",
        to: "2030-09-20",
        partial: null,
      });
      expect(large.statusCode, large.body).toBe(200);
      expect(
        (await decide(manager.cookie, large.json().id, "APPROVE")).statusCode,
      ).toBe(409);
    });
    it("stores sickness dates/status only and exposes decisions in the authenticated application", async () => {
      const body = {
        idempotencyKey: key(),
        category: "SICKNESS",
        from: "2030-08-21",
        to: "2030-08-21",
        partial: null,
      };
      expect(
        (await send(worker.cookie, "leave", { ...body, diagnosis: "PRIVATE" }))
          .statusCode,
      ).toBe(400);
      const req = await send(worker.cookie, "leave", body);
      expect(req.statusCode, req.body).toBe(200);
      const r = await decide(manager.cookie, req.json().id, "REJECT", 0, {
        reason: "Must not store diagnostic text",
      });
      expect(r.statusCode).toBe(200);
      expect(r.body).not.toContain("diagnostic");
      expect(
        (await ops(worker.cookie)).requests.find(
          (x: { id: string }) => x.id === req.json().id,
        ).status,
      ).toBe("REJECTED");
      expect(
        (await ops(unqualified.cookie)).requests.some(
          (x: { id: string }) => x.id === req.json().id,
        ),
      ).toBe(false);
    });
    it("qualified swap requires coworker consent, commits one manager decision and uses canonical WF1 publication history", async () => {
      const workspace = await ops(worker.cookie),
        first = workspace.shifts.find(
          (x: { assignmentId: string }) => x.assignmentId === shifts[1]!.id,
        ),
        second = (
          await send(
            worker.cookie,
            "exchange-options?assignmentId=" +
              first.assignmentId +
              "&targetMembershipId=" +
              partner.membershipId,
          )
        )
          .json()
          .shifts.find(
            (x: { assignmentId: string }) => x.assignmentId === shifts[2]!.id,
          );
      const req = await send(worker.cookie, "shift-requests", {
        idempotencyKey: key(),
        kind: "SWAP",
        assignmentId: first.assignmentId,
        publicationRevisionId: first.publicationRevisionId,
        targetMembershipId: partner.membershipId,
        otherAssignmentId: second.assignmentId,
        otherPublicationRevisionId: second.publicationRevisionId,
      });
      expect(req.statusCode, req.body).toBe(200);
      const id = req.json().id;
      expect((await decide(manager.cookie, id, "APPROVE")).statusCode).toBe(
        409,
      );
      expect((await decide(unqualified.cookie, id, "ACCEPT")).statusCode).toBe(
        400,
      );
      expect((await decide(partner.cookie, id, "ACCEPT")).statusCode).toBe(200);
      const results = await Promise.all([
        decide(manager.cookie, id, "APPROVE", 1),
        decide(manager2.cookie, id, "APPROVE", 1),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const canonical = await app.inject({
        method: "GET",
        url: "/v1/staff/workforce?from=2030-08-12&to=2030-08-18",
        headers: { cookie: de.owner.cookie },
      });
      expect(canonical.statusCode, canonical.body).toBe(200);
      const plan = canonical.json().schedules[0];
      expect(
        plan.snapshot.assignments.find(
          (a: { id: string }) => a.id === first.assignmentId,
        ).membershipId,
      ).toBe(partner.membershipId);
      expect(
        plan.snapshot.assignments.find(
          (a: { id: string }) => a.id === second.assignmentId,
        ).membershipId,
      ).toBe(worker.membershipId);
      expect(
        await prisma.scheduleRevision.count({ where: { scheduleId: plan.id } }),
      ).toBe(2);
      expect(
        await prisma.scheduleAssignment.count({
          where: { scheduleId: plan.id },
        }),
      ).toBe(5);
    });
    it("unqualified offer is blocked, accepted offers can be withdrawn and invitees can decline", async () => {
      let w = await ops(worker.cookie),
        row = w.shifts.find(
          (x: { assignmentId: string }) => x.assignmentId === shifts[4]!.id,
        );
      const make = (target: string) =>
        send(worker.cookie, "shift-requests", {
          idempotencyKey: key(),
          kind: "OFFER",
          assignmentId: row.assignmentId,
          publicationRevisionId: row.publicationRevisionId,
          targetMembershipId: target,
          otherAssignmentId: null,
          otherPublicationRevisionId: null,
        });
      let req = await make(unqualified.membershipId);
      expect(req.statusCode, req.body).toBe(200);
      expect(
        (await decide(unqualified.cookie, req.json().id, "ACCEPT")).statusCode,
      ).toBe(200);
      expect(
        (await decide(manager.cookie, req.json().id, "APPROVE", 1)).statusCode,
      ).toBe(409);
      expect(
        (await decide(worker.cookie, req.json().id, "WITHDRAW", 1)).statusCode,
      ).toBe(200);
      req = await make(partner.membershipId);
      expect(
        (await decide(partner.cookie, req.json().id, "DECLINE")).statusCode,
      ).toBe(200);
      expect(
        (await ops(worker.cookie)).requests.find(
          (x: { id: string }) => x.id === req.json().id,
        ).status,
      ).toBe("REJECTED");
    });
    it("two concurrent open-shift approvals cannot double-claim or overwrite a published revision", async () => {
      const w = await ops(worker.cookie),
        row = w.shifts.find(
          (x: { assignmentId: string }) => x.assignmentId === shifts[3]!.id,
        ),
        payload = {
          kind: "OPEN",
          assignmentId: row.assignmentId,
          publicationRevisionId: row.publicationRevisionId,
          targetMembershipId: null,
          otherAssignmentId: null,
          otherPublicationRevisionId: null,
        };
      const a = await send(worker.cookie, "shift-requests", {
          ...payload,
          idempotencyKey: key(),
        }),
        b = await send(partner.cookie, "shift-requests", {
          ...payload,
          idempotencyKey: key(),
        });
      expect(a.statusCode, a.body).toBe(200);
      expect(b.statusCode, b.body).toBe(200);
      const results = await Promise.all([
        decide(manager.cookie, a.json().id, "APPROVE"),
        decide(manager2.cookie, b.json().id, "APPROVE"),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect(
        await prisma.workforceRequest.count({
          where: { id: { in: [a.json().id, b.json().id] }, status: "APPROVED" },
        }),
      ).toBe(1);
      expect(
        await prisma.scheduleAssignment.count({
          where: { id: row.assignmentId },
        }),
      ).toBe(1);
    });
    it("approved absence blocks incoming shifts and outstanding drafts invalidate request approval", async () => {
      const req = await send(worker.cookie, "leave", {
        idempotencyKey: key(),
        category: "UNPAID",
        from: "2030-08-17",
        to: "2030-08-17",
        partial: null,
      });
      expect(req.statusCode, req.body).toBe(200);
      expect(
        (await decide(manager.cookie, req.json().id, "APPROVE")).statusCode,
      ).toBe(200);
      const w = await ops(worker.cookie),
        row = w.shifts.find(
          (x: { assignmentId: string }) => x.assignmentId === shifts[4]!.id,
        );
      const offer = await send(worker.cookie, "shift-requests", {
        idempotencyKey: key(),
        kind: "OFFER",
        assignmentId: row.assignmentId,
        publicationRevisionId: row.publicationRevisionId,
        targetMembershipId: partner.membershipId,
        otherAssignmentId: null,
        otherPublicationRevisionId: null,
      });
      expect(offer.statusCode).toBe(200);
      expect(
        (await decide(partner.cookie, offer.json().id, "ACCEPT")).statusCode,
      ).toBe(200);
      const leave = await send(partner.cookie, "leave", {
        idempotencyKey: key(),
        category: "UNPAID",
        from: "2030-08-17",
        to: "2030-08-17",
        partial: null,
      });
      expect(leave.statusCode).toBe(200);
      expect(
        (await decide(manager.cookie, leave.json().id, "APPROVE")).statusCode,
      ).toBe(200);
      expect(
        (await decide(manager.cookie, offer.json().id, "APPROVE", 1))
          .statusCode,
      ).toBe(409);
    });
    it("availability and rest controls revalidate accepted offers and new drafts cannot bypass request revision checks", async () => {
      const ownPlan = await app.inject({
        method: "GET",
        url: "/v1/staff/workforce?from=2030-08-12&to=2030-08-18",
        headers: { cookie: de.owner.cookie },
      });
      expect(ownPlan.statusCode).toBe(200);
      const plan = ownPlan.json().schedules[0],
        inputs = plan.snapshot.assignments.map((a: any) => {
          const { userId, role, displayName, startsAt, endsAt, ...rest } = a;
          return rest;
        });
      const row = (await ops(worker.cookie)).shifts.find(
        (a: { assignmentId: string }) => a.assignmentId === shifts[4]!.id,
      );
      const make = () =>
        send(worker.cookie, "shift-requests", {
          idempotencyKey: key(),
          kind: "OFFER",
          assignmentId: row.assignmentId,
          publicationRevisionId: row.publicationRevisionId,
          targetMembershipId: recovery.membershipId,
          otherAssignmentId: null,
          otherPublicationRevisionId: null,
        });
      let req = await make();
      expect(req.statusCode, req.body).toBe(200);
      expect(
        (await decide(recovery.cookie, req.json().id, "ACCEPT")).statusCode,
      ).toBe(200);
      const draft = await send(
        de.owner.cookie,
        "schedule",
        {
          week: "2030-08-12",
          expectedVersion: plan.version,
          status: "DRAFT",
          reviewConfirmed: false,
          assignments: inputs,
        },
        "PUT",
      );
      expect(draft.statusCode, draft.body).toBe(200);
      expect(
        (await decide(manager.cookie, req.json().id, "APPROVE", 1)).statusCode,
      ).toBe(409);
      const night = shift(
        recovery.membershipId,
        "2030-08-16",
        "22:00",
        "23:45",
      );
      night.endsLocal = "2030-08-17T04:00";
      const publish = await send(
        de.owner.cookie,
        "schedule",
        {
          week: "2030-08-12",
          expectedVersion: draft.json().version,
          status: "PUBLISHED",
          reviewConfirmed: true,
          assignments: [...inputs, night],
        },
        "PUT",
      );
      expect(publish.statusCode, publish.body).toBe(200);
      req = await make();
      expect(req.statusCode, req.body).toBe(200);
      expect(
        (await decide(recovery.cookie, req.json().id, "ACCEPT")).statusCode,
      ).toBe(200);
      let profile = await send(
        de.owner.cookie,
        "profiles/" + recovery.membershipId,
      );
      let update = await send(
        de.owner.cookie,
        "profiles/" + recovery.membershipId,
        {
          expectedVersion: profile.json().version,
          recurringAvailability: [{ day: 1, startMinute: 480, endMinute: 720 }],
        },
        "PUT",
      );
      expect(update.statusCode).toBe(200);
      expect(
        (await decide(manager.cookie, req.json().id, "APPROVE", 1)).statusCode,
      ).toBe(409);
      profile = await send(
        de.owner.cookie,
        "profiles/" + recovery.membershipId,
      );
      update = await send(
        de.owner.cookie,
        "profiles/" + recovery.membershipId,
        { expectedVersion: profile.json().version, recurringAvailability: [] },
        "PUT",
      );
      expect(update.statusCode).toBe(200);
      expect(
        (
          await decide(manager.cookie, req.json().id, "APPROVE", 1, {
            warningsAcknowledged: false,
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (await decide(manager.cookie, req.json().id, "APPROVE", 1)).statusCode,
      ).toBe(200);
    });
    it("immutable policy versions freeze old evidence and cross-venue allowance/role scope stays protected", async () => {
      const w = await ops(de.owner.cookie),
        oldId = w.policy.id;
      const changed = await send(de.owner.cookie, "policy", {
        expectedVersion: w.policy.version,
        effectiveFrom: "2030-08-14",
        countryCode: "DE",
        reason: "Explicit future policy version",
        rules: { ...w.rules, minimumRestMinutes: 720 },
      });
      expect(changed.statusCode, changed.body).toBe(200);
      expect(
        (
          await prisma.workforceAttendance.findUniqueOrThrow({
            where: { id: attendanceId },
          })
        ).policyRevisionId,
      ).toBe(oldId);
      await expect(
        prisma.workforcePolicy.update({
          where: { id: oldId },
          data: { reason: "replace" },
        }),
      ).rejects.toThrow();
      expect(
        (
          await send(
            manager.cookie,
            "leave-allowance/" + worker.membershipId + "?year=2030",
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await send(
            al.owner.cookie,
            "leave-allowance/" + worker.membershipId + "?year=2030",
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await send(
            secondCookie,
            "leave-allowance/" + worker.membershipId + "?year=2030",
          )
        ).statusCode,
      ).toBe(404);
      const historical = await send(
        worker.cookie,
        "leave-allowance/" + worker.membershipId + "?year=2030",
      );
      expect(historical.statusCode).toBe(200);
      expect(historical.json().history.length).toBeGreaterThan(0);
    });
    it("an active session can finish under its frozen policy after an effective country change", async () => {
      advance("2030-08-13T20:00Z");
      const start = await punch(recovery.cookie, "CLOCK_IN", 0);
      expect(start.statusCode, start.body).toBe(200);
      const old = await prisma.workforceAttendance.findUniqueOrThrow({
        where: { id: start.json().attendanceId },
      });
      const profile = await send(
        de.owner.cookie,
        "profiles/" + recovery.membershipId,
      );
      const contract = await send(
        de.owner.cookie,
        "profiles/" + recovery.membershipId + "/contracts",
        {
          expectedVersion: profile.json().version,
          effectiveFrom: "2030-08-14",
          employmentType: "FULL_TIME",
          weeklyTargetMinutes: 2400,
          monthlyTargetMinutes: null,
          countryCode: "FR",
          terms: "Synthetic future country change",
        },
      );
      expect(contract.statusCode, contract.body).toBe(200);
      advance("2030-08-14T00:00Z");
      const end = await punch(recovery.cookie, "CLOCK_OUT", 1);
      expect(end.statusCode, end.body).toBe(200);
      expect(
        (
          await prisma.workforceAttendance.findUniqueOrThrow({
            where: { id: old.id },
          })
        ).policyRevisionId,
      ).toBe(old.policyRevisionId);
      expect((await punch(recovery.cookie, "CLOCK_IN", 0)).statusCode).toBe(
        400,
      );
    });
    it("history survives worker deactivation; DB evidence rejects edits and HR privacy stays intact", async () => {
      const count = await prisma.workforceAttendanceEvent.count({
        where: { userId: partner.userId },
      });
      const disabled = await app.inject({
        method: "PATCH",
        url: "/v1/staff/team/members/" + partner.membershipId,
        headers: { cookie: de.owner.cookie },
        payload: { active: false },
      });
      expect(disabled.statusCode, disabled.body).toBe(200);
      expect(
        await prisma.workforceAttendanceEvent.count({
          where: { userId: partner.userId },
        }),
      ).toBe(count);
      expect(
        (await ops(manager.cookie)).attendance.some(
          (a: { userId: string }) => a.userId === partner.userId,
        ),
      ).toBe(true);
      const event = await prisma.workforceAttendanceEvent.findFirstOrThrow({
        where: { attendanceId },
      });
      await expect(
        prisma.workforceAttendanceEvent.update({
          where: { id: event.id },
          data: { occurredAt: new Date() },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.workforceAttendanceEvent.delete({ where: { id: event.id } }),
      ).rejects.toThrow();
      await expect(
        prisma.workforceAttendance.update({
          where: { id: attendanceId },
          data: { startedAt: new Date(), version: { increment: 1 } },
        }),
      ).rejects.toThrow();
      const p = await send(manager.cookie, "profiles/" + worker.membershipId);
      expect(p.statusCode).toBe(200);
      expect(p.body).not.toContain("PRIVATE CONTRACT TEXT");
      expect(p.json().contracts).toBeUndefined();
      expect((await ops(manager.cookie)).attendance.length).toBeGreaterThan(0);
      expect(JSON.stringify(await ops(manager.cookie))).not.toContain(
        "PRIVATE CONTRACT TEXT",
      );
    });
    it("manager recovery closes offboarded attendance through an independently approved compensating proposal", async () => {
      const offboard = await de.addEmployee("Synthetic Offboarded Worker");
      await configureEmployee(offboard);
      advance("2030-08-14T01:00Z");
      const started = await punch(offboard.cookie, "CLOCK_IN", 0);
      expect(started.statusCode, started.body).toBe(200);
      const id = started.json().attendanceId;
      const before = JSON.stringify(
        await prisma.workforceAttendanceEvent.findMany({
          where: { attendanceId: id },
        }),
      );
      const disabled = await app.inject({
        method: "PATCH",
        url: "/v1/staff/team/members/" + offboard.membershipId,
        headers: { cookie: de.owner.cookie },
        payload: { active: false },
      });
      expect(disabled.statusCode, disabled.body).toBe(200);
      advance("2030-08-14T06:00Z");
      const body = {
        idempotencyKey: key(),
        attendanceId: id,
        expectedAttendanceVersion: 1,
        reason: "MISSING_OUT",
        startsLocal: "2030-08-14T03:00",
        endsLocal: "2030-08-14T07:00",
        breaks: [],
      };
      expect(
        (
          await send(
            worker.cookie,
            "attendance/" + id + "/recovery-request",
            body,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await send(
            al.owner.cookie,
            "attendance/" + id + "/recovery-request",
            body,
          )
        ).statusCode,
      ).toBe(404);
      const request = await send(
        manager.cookie,
        "attendance/" + id + "/recovery-request",
        body,
      );
      expect(request.statusCode, request.body).toBe(200);
      expect(request.json().userId).toBe(offboard.userId);
      expect(
        (
          await send(
            manager.cookie,
            "attendance/" + id + "/recovery-request",
            body,
          )
        ).json().id,
      ).toBe(request.json().id);
      expect(
        (await decide(manager.cookie, request.json().id, "APPROVE")).statusCode,
      ).toBe(400);
      const approved = await decide(
        manager2.cookie,
        request.json().id,
        "APPROVE",
      );
      expect(approved.statusCode, approved.body).toBe(200);
      const a = await prisma.workforceAttendance.findUniqueOrThrow({
        where: { id },
        include: { events: true, approvals: true },
      });
      expect(a.state).toBe("CLOSED");
      expect(
        (a.approvals[0]!.calculation as { workedMinutes: number })
          .workedMinutes,
      ).toBe(240);
      expect(
        JSON.stringify(a.events.filter((e) => e.kind !== "CORRECTION")),
      ).toBe(before);
    });
    it("durable event intents have exact authorized recipients and audit references, without channel delivery or HR payload", async () => {
      const intents = await prisma.workforceEventIntent.findMany({
        where: { tenantId: de.owner.tenantId },
      });
      expect(intents.length).toBeGreaterThan(10);
      for (const event of intents) {
        expect(event.venueId).toBe(de.owner.venueId);
        const scopedUsers = await prisma.membership.findMany({
          where: { tenantId: de.owner.tenantId, venueId: de.owner.venueId },
          select: { userId: true },
        });
        expect(
          event.recipientUserIds.every((id) =>
            scopedUsers.some((m) => m.userId === id),
          ),
        ).toBe(true);
        expect(
          await prisma.auditEvent.findUnique({
            where: {
              id: (event.payload as { auditEventId: string }).auditEventId,
            },
          }),
        ).not.toBeNull();
        expect(JSON.stringify(event.payload)).not.toMatch(
          /diagnosis|PRIVATE CONTRACT|password|email|phone|channel|delivered/i,
        );
      }
    });
    it("real AL attendance spans spring and autumn DST with exact elapsed UTC minutes", async () => {
      const staff = await al.addEmployee("Synthetic Albanian DST Worker");
      advance("2030-03-30T23:00Z");
      expect((await punch(staff.cookie, "CLOCK_IN", 0)).statusCode).toBe(200);
      advance("2030-03-31T04:00Z");
      expect((await punch(staff.cookie, "CLOCK_OUT", 1)).statusCode).toBe(200);
      expect(
        (await ops(staff.cookie, "2030-03-30", "2030-03-31")).attendance[0]
          .totals.workedMinutes,
      ).toBe(300);
      advance("2030-10-26T22:00Z");
      expect((await punch(staff.cookie, "CLOCK_IN", 0)).statusCode).toBe(200);
      advance("2030-10-27T05:00Z");
      expect((await punch(staff.cookie, "CLOCK_OUT", 1)).statusCode).toBe(200);
      expect(
        (await ops(staff.cookie, "2030-10-26", "2030-10-27")).attendance[0]
          .totals.workedMinutes,
      ).toBe(420);
    });
    it("approved corrections remain discoverable after moving outside the original period", async () => {
      const original = await prisma.workforceAttendance.findUniqueOrThrow({
          where: { id: attendanceId },
        }),
        snapshot = {
          idempotencyKey: key(),
          attendanceId,
          expectedAttendanceVersion: original.version,
          reason: "INTERVAL",
          startsLocal: "2030-09-02T09:00",
          endsLocal: "2030-09-02T17:00",
          breaks: [
            {
              startsLocal: "2030-09-02T12:00",
              endsLocal: "2030-09-02T12:30",
              kind: "UNPAID",
            },
          ],
        };
      const proposal = await send(worker.cookie, "corrections", snapshot);
      expect(proposal.statusCode, proposal.body).toBe(200);
      const decision = await decide(
        manager.cookie,
        proposal.json().id,
        "APPROVE",
      );
      expect(decision.statusCode, decision.body).toBe(200);
      const view = await ops(worker.cookie, "2030-09-02", "2030-09-08");
      expect(
        view.attendance.find((a: { id: string }) => a.id === attendanceId)
          .approved.totals.workedMinutes,
      ).toBe(450);
      expect(
        (await ops(worker.cookie, "2030-08-12", "2030-08-18")).attendance.some(
          (a: { id: string }) => a.id === attendanceId,
        ),
      ).toBe(false);
      const sources = await send(
        worker.cookie,
        "approved-hours?from=2030-09-02&to=2030-09-08",
      );
      expect(sources.statusCode, sources.body).toBe(200);
      expect(
        sources
          .json()
          .records.some(
            (a: { attendanceId: string }) => a.attendanceId === attendanceId,
          ),
      ).toBe(true);
      expect(
        (
          await prisma.workforceAttendance.findUniqueOrThrow({
            where: { id: attendanceId },
          })
        ).startedAt,
      ).toEqual(original.startedAt);
    });
    it("canonical approved-hours is complete beyond the 200-row UI limit and remains scoped", async () => {
      const complete = await de.addEmployee("Synthetic Complete Source Worker");
      await configureEmployee(complete);
      const start = Date.parse("2031-01-02T08:00:00Z");
      const ids: string[] = [];
      for (let i = 0; i < 251; i++) {
        now = new Date(start + i * 60000 * 2);
        let r = await punch(complete.cookie, "CLOCK_IN", 0);
        expect(r.statusCode, r.body).toBe(200);
        const id = r.json().attendanceId;
        ids.push(id);
        now = new Date(start + (i * 2 + 1) * 60000);
        r = await punch(complete.cookie, "CLOCK_OUT", 1);
        expect(r.statusCode, r.body).toBe(200);
        r = await send(manager.cookie, "attendance/" + id + "/approval", {
          expectedVersion: 2,
          reason: "Synthetic completeness acceptance",
          reviewConfirmed: true,
          warningsAcknowledged: true,
        });
        expect(r.statusCode, r.body).toBe(200);
      }
      const ui = await ops(complete.cookie, "2031-01-01", "2031-01-31");
      expect(ui.attendance).toHaveLength(200);
      expect(ui.truncated).toBe(true);
      for (const cookie of [complete.cookie, manager.cookie, de.owner.cookie]) {
        const r = await send(
          cookie,
          "approved-hours?from=2031-01-01&to=2031-01-31",
        );
        expect(r.statusCode, r.body).toBe(200);
        expect(r.json().truncated).toBe(false);
        expect(r.json().records).toHaveLength(251);
        expect(
          r
            .json()
            .records.reduce(
              (n: number, x: { totals: { workedMs: number } }) =>
                n + x.totals.workedMs,
              0,
            ),
        ).toBe(251 * 60000);
        expect(
          new Set(
            r
              .json()
              .records.map((x: { attendanceId: string }) => x.attendanceId),
          ),
        ).toEqual(new Set(ids));
      }
      expect(
        (
          await send(
            partner.cookie,
            "approved-hours?from=2031-01-01&to=2031-01-31",
          )
        ).statusCode,
      ).toBe(401);
      for (const cookie of [worker.cookie, al.owner.cookie, secondCookie]) {
        const r = await send(
          cookie,
          "approved-hours?from=2031-01-01&to=2031-01-31",
        );
        expect(r.statusCode, r.body).toBe(200);
        expect(r.json().records).toEqual([]);
      }
    }, 120000);
  });
