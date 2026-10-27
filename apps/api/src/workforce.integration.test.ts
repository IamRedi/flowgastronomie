import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { prisma } from "@flowgastronomie/database";
import { workforceFixture } from "../../../tests/workforce/fixtures.js";
import {
  workforceMove,
  type WorkforceAssignment,
} from "@flowgastronomie/domain";
const app = buildApp();
const week = "2030-08-12";
function row(membershipId: string | null, day = week): WorkforceAssignment {
  return {
    id: randomUUID(),
    membershipId,
    station: "KITCHEN",
    startsLocal: day + "T10:00",
    endsLocal: day + "T18:00",
    startChoice: "reject",
    endChoice: "reject",
    breakMinutes: 30,
    requiredSkills: [],
    note: "Opening station",
  };
}
const send = (
  cookie: string,
  url: string,
  payload?: unknown,
  method = payload ? "POST" : "GET",
) =>
  app.inject({
    method: method as "POST" | "GET" | "PUT",
    url,
    headers: { cookie },
    ...(payload ? { payload: payload as Record<string, unknown> } : {}),
  });
let de: Awaited<ReturnType<typeof workforceFixture>>,
  al: Awaited<ReturnType<typeof workforceFixture>>,
  worker: Awaited<ReturnType<typeof de.addEmployee>>,
  manager: typeof worker;
let id: string,
  version = 0;
describe
  .skipIf(process.env.WORKFORCE_DB_GATE !== "true")
  .sequential("WF1 canonical API and PostgreSQL", () => {
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (!/^workforce_gate_\d+$/.test(url.searchParams.get("schema") ?? ""))
        throw new Error("Isolated workforce schema required");
      de = await workforceFixture(app, "DE");
      al = await workforceFixture(app, "AL");
      worker = await de.addEmployee("Synthetic Worker");
      manager = await de.addEmployee("Synthetic Manager", "MANAGER");
    });
    afterAll(async () => {
      await app.close();
      await prisma.$disconnect();
    });
    const workspace = async (
      cookie: string,
      from = week,
      to = "2030-08-31",
    ) => {
      const r = await send(
        cookie,
        "/v1/staff/workforce?from=" + from + "&to=" + to,
      );
      expect(r.statusCode, r.body).toBe(200);
      return r.json();
    };
    const save = async (
      cookie: string,
      assignments: WorkforceAssignment[],
      expectedVersion: number,
      status = "DRAFT",
      w = week,
    ) =>
      send(
        cookie,
        "/v1/staff/workforce/schedule",
        {
          week: w,
          expectedVersion,
          status,
          reviewConfirmed: status === "PUBLISHED",
          assignments,
        },
        "PUT",
      );
    it("registers independently and creates professional profile + immutable effective-dated contract", async () => {
      expect(de.owner.tenantId).not.toBe(al.owner.tenantId);
      const blank = await workspace(worker.cookie);
      expect(blank.schedules).toEqual([]);
      expect(blank.profiles).toHaveLength(1);
      const updated = await send(
        de.owner.cookie,
        "/v1/staff/workforce/profiles/" + worker.membershipId,
        {
          expectedVersion: 0,
          jobTitle: "Station specialist",
          workPhone: "+49 30 000000",
          employmentStartedOn: "2026-01-01",
          stations: ["KITCHEN"],
          skills: ["Food safety"],
          annualLeaveDays: 24,
          recurringAvailability: [
            { day: 1, startMinute: 480, endMinute: 1200 },
          ],
        },
        "PUT",
      );
      expect(updated.statusCode, updated.body).toBe(200);
      expect(updated.json().version).toBe(1);
      const contract = await send(
        de.owner.cookie,
        "/v1/staff/workforce/profiles/" + worker.membershipId + "/contracts",
        {
          expectedVersion: 1,
          effectiveFrom: "2026-01-01",
          employmentType: "PART_TIME",
          weeklyTargetMinutes: 1200,
          monthlyTargetMinutes: 5200,
          countryCode: "DE",
          terms: "Synthetic private terms",
        },
      );
      expect(contract.statusCode, contract.body).toBe(200);
      expect(contract.json().contracts).toHaveLength(1);
      const old = contract.json().contracts[0];
      await expect(
        prisma.staffEmploymentContract.update({
          where: { id: old.id },
          data: { weeklyTargetMinutes: 2400 },
        }),
      ).rejects.toThrow("append-only");
      const history = await prisma.staffProfileRevision.findMany({
        where: { profileId: contract.json().profileId },
      });
      expect(history).toHaveLength(1);
      expect(history[0]?.after).toHaveProperty(
        "jobTitle",
        "Station specialist",
      );
    });
    it("restricts HR to Owner/self, supports worker self contact, and rejects stale profile or backdated contract", async () => {
      const view = await workspace(manager.cookie);
      const profile = view.profiles.find(
        (p: { membershipId: string }) => p.membershipId === worker.membershipId,
      );
      expect(profile.contracts).toBeUndefined();
      expect(profile.documents).toBeUndefined();
      expect(profile.targetWeeklyMinutes).toBe(1200);
      expect(
        (
          await send(
            manager.cookie,
            "/v1/staff/workforce/profiles/" +
              worker.membershipId +
              "/contracts",
            {
              expectedVersion: 2,
              effectiveFrom: "2030-01-01",
              employmentType: "FULL_TIME",
              weeklyTargetMinutes: 2400,
              monthlyTargetMinutes: null,
              countryCode: "DE",
              terms: "",
            },
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await send(
            worker.cookie,
            "/v1/staff/workforce/profiles/" + de.owner.membershipId,
          )
        ).statusCode,
      ).toBe(403);
      const self = await send(
        worker.cookie,
        "/v1/staff/workforce/profiles/" + worker.membershipId,
        { expectedVersion: 2, workPhone: "+49 30 000001" },
        "PUT",
      );
      expect(self.statusCode, self.body).toBe(200);
      expect(self.json().contracts[0].terms).toBe("Synthetic private terms");
      expect(
        (
          await send(
            worker.cookie,
            "/v1/staff/workforce/profiles/" + worker.membershipId,
            { expectedVersion: 2, workPhone: "old" },
            "PUT",
          )
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await send(
            de.owner.cookie,
            "/v1/staff/workforce/profiles/" +
              worker.membershipId +
              "/contracts",
            {
              expectedVersion: 3,
              effectiveFrom: "2026-01-02",
              employmentType: "FULL_TIME",
              weeklyTargetMinutes: 2400,
              monthlyTargetMinutes: null,
              countryCode: "DE",
              terms: "Changed",
            },
          )
        ).json().code,
      ).toBe("PAST");
    });
    it("keeps draft invisible, publishes with approval, and retains stable IDs through edit/republish", async () => {
      const a = row(worker.membershipId);
      id = a.id;
      const created = await save(manager.cookie, [a], 0);
      expect(created.statusCode, created.body).toBe(200);
      version = created.json().version;
      expect((await workspace(worker.cookie)).schedules).toHaveLength(0);
      const denied = await send(
        manager.cookie,
        "/v1/staff/workforce/schedule",
        {
          week,
          expectedVersion: version,
          status: "PUBLISHED",
          reviewConfirmed: false,
          assignments: [a],
        },
        "PUT",
      );
      expect(denied.json().code).toBe("APPROVAL");
      const pub = await save(manager.cookie, [a], version, "PUBLISHED");
      expect(pub.statusCode, pub.body).toBe(200);
      version = pub.json().version;
      const workerView = await workspace(worker.cookie);
      expect(workerView.schedules[0].snapshot.assignments[0].id).toBe(id);
      expect(workerView.history).toEqual([]);
      const immutable = await prisma.scheduleRevision.findFirstOrThrow({
        where: { scheduleId: pub.json().id, status: "PUBLISHED" },
      });
      await expect(
        prisma.scheduleRevision.update({
          where: { id: immutable.id },
          data: { version: 99 },
        }),
      ).rejects.toThrow("append-only");
      const changed = { ...a, endsLocal: week + "T19:00" };
      const draft = await save(manager.cookie, [changed], version);
      expect(draft.statusCode, draft.body).toBe(200);
      version = draft.json().version;
      expect(
        (await workspace(worker.cookie)).schedules[0].snapshot.assignments[0]
          .endsLocal,
      ).toBe(a.endsLocal);
      const repub = await save(manager.cookie, [changed], version, "PUBLISHED");
      expect(repub.statusCode, repub.body).toBe(200);
      version = repub.json().version;
      expect(
        (await workspace(worker.cookie)).schedules[0].snapshot.assignments[0]
          .endsLocal,
      ).toBe(changed.endsLocal);
      expect(
        await prisma.scheduleAssignment.count({
          where: { scheduleId: pub.json().id },
        }),
      ).toBe(1);
      expect(
        (await prisma.scheduleAssignment.findUniqueOrThrow({ where: { id } }))
          .membershipId,
      ).toBe(worker.membershipId);
      expect(
        (
          await prisma.membership.findUniqueOrThrow({
            where: { id: worker.membershipId },
          })
        ).role,
      ).toBe("WAITER");
    });
    it("rejects tenant/venue access and protects two simultaneous managers", async () => {
      expect(
        (
          await send(
            al.owner.cookie,
            "/v1/staff/workforce/profiles/" + worker.membershipId,
          )
        ).statusCode,
      ).toBe(404);
      const current = (await workspace(manager.cookie)).schedules[0].snapshot
        .assignments[0];
      const { userId, displayName, role, startsAt, endsAt, ...a } = current;
      const results = await Promise.all([
        save(manager.cookie, [{ ...a, note: "manager A" }], version),
        save(de.owner.cookie, [{ ...a, note: "manager B" }], version),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      version = results.find((r) => r.statusCode === 200)!.json().version;
      expect((await save(worker.cookie, [a], version)).statusCode).toBe(403);
    });
    it("moves across weeks atomically with the same ID; only publication changes employee visibility", async () => {
      const current = (await workspace(manager.cookie)).schedules[0].snapshot
        .assignments[0];
      const { userId, displayName, role, startsAt, endsAt, ...a } = current;
      const target = workforceMove(a, "2030-08-19", worker.membershipId);
      const moved = await send(manager.cookie, "/v1/staff/workforce/move", {
        sourceWeek: week,
        sourceVersion: version,
        targetVersion: 0,
        assignment: target,
      });
      expect(moved.statusCode, moved.body).toBe(200);
      version++;
      const source = await prisma.venueSchedule.findFirstOrThrow({
        where: {
          tenantId: de.owner.tenantId,
          weekStartsOn: new Date(week + "T00:00:00Z"),
        },
      });
      const physical = await prisma.scheduleAssignment.findUniqueOrThrow({
        where: { id },
      });
      expect(physical.scheduleId).toBe(moved.json().id);
      expect(
        (await workspace(worker.cookie)).schedules[0].snapshot.assignments[0]
          .startsLocal,
      ).toBe(a.startsLocal);
      const published = await save(
        manager.cookie,
        [target],
        moved.json().version,
        "PUBLISHED",
        "2030-08-19",
      );
      expect(published.statusCode, published.body).toBe(200);
      let rows = (await workspace(worker.cookie)).schedules.flatMap(
        (s: { snapshot: { assignments: unknown[] } }) => s.snapshot.assignments,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].startsLocal).toBe(target.startsLocal);
      const cleaned = await save(
        manager.cookie,
        [],
        source.version,
        "PUBLISHED",
      );
      expect(cleaned.statusCode, cleaned.body).toBe(200);
      version = cleaned.json().version;
      rows = (await workspace(worker.cookie)).schedules.flatMap(
        (s: { snapshot: { assignments: unknown[] } }) => s.snapshot.assignments,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(id);
    });
    it("blocks overlapping user assignments across venue memberships without changing role", async () => {
      const v = await prisma.venue.create({
        data: {
          tenantId: de.owner.tenantId,
          name: "Synthetic second venue",
          slug: randomUUID(),
          timezone: "Europe/Berlin",
        },
      });
      const m = await prisma.membership.create({
        data: {
          tenantId: de.owner.tenantId,
          venueId: v.id,
          userId: worker.userId,
          role: "KITCHEN",
        },
      });
      // Same user, different membership: the canonical overlap guard is tenant-wide.
      const own = await prisma.membership.create({
        data: {
          tenantId: de.owner.tenantId,
          venueId: v.id,
          userId: de.owner.userId,
          role: "OWNER",
        },
      });
      const session = await prisma.staffSession.create({
        data: {
          tenantId: de.owner.tenantId,
          venueId: v.id,
          userId: de.owner.userId,
          membershipId: own.id,
          tokenHash: "not-login",
          expiresAt: new Date("2035-01-01"),
        },
      });
      const { workforceRepository } = await import("@flowgastronomie/database");
      await expect(
        workforceRepository.saveSchedule(
          {
            ...de.owner,
            venueId: v.id,
            membershipId: own.id,
            sessionId: session.id,
          },
          {
            week: "2030-08-19",
            expectedVersion: 0,
            status: "DRAFT",
            assignments: [row(m.id, "2030-08-19")],
          },
        ),
      ).rejects.toThrow("overlapping");
    });
    it("handles Berlin/Tirane DST fold and rejects gaps and stale schedule writes", async () => {
      for (const owner of [de.owner, al.owner]) {
        const a = {
          ...row(owner.membershipId, "2030-10-27"),
          startsLocal: "2030-10-27T02:30",
          endsLocal: "2030-10-27T02:30",
          breakMinutes: 0,
        };
        const ambiguous = await save(
          owner.cookie,
          [a],
          0,
          "DRAFT",
          "2030-10-21",
        );
        expect(ambiguous.json().code).toBe("TIME");
        const saved = await save(
          owner.cookie,
          [{ ...a, startChoice: "earlier", endChoice: "later" }],
          0,
          "PUBLISHED",
          "2030-10-21",
        );
        expect(saved.statusCode, saved.body).toBe(200);
        const r = saved.json().snapshot.assignments[0];
        expect(Date.parse(r.endsAt) - Date.parse(r.startsAt)).toBe(3600000);
        const gap = {
          ...row(owner.membershipId, "2030-03-31"),
          startsLocal: "2030-03-31T02:30",
          endsLocal: "2030-03-31T04:00",
        };
        expect(
          (await save(owner.cookie, [gap], 0, "DRAFT", "2030-03-25")).json()
            .code,
        ).toBe("TIME");
      }
    });
    it("encrypts work documents, logs scoped access and denies manager/foreign reads", async () => {
      const detail = (
        await send(
          worker.cookie,
          "/v1/staff/workforce/profiles/" + worker.membershipId,
        )
      ).json();
      const bytes = Buffer.from("%PDF-1.7\\nSynthetic work certificate");
      const uploaded = await send(
        worker.cookie,
        "/v1/staff/workforce/profiles/" + worker.membershipId + "/documents",
        {
          expectedVersion: detail.version,
          title: "Synthetic qualification",
          kind: "CERTIFICATION",
          expiresOn: "2031-01-01",
          filename: "work.pdf",
          base64: bytes.toString("base64"),
        },
      );
      expect(uploaded.statusCode, uploaded.body).toBe(200);
      const d = await prisma.staffWorkDocument.findUniqueOrThrow({
        where: { id: uploaded.json().id },
      });
      expect(Buffer.from(d.ciphertext).equals(bytes)).toBe(false);
      expect(d.nonce.length).toBe(12);
      const download = await send(
        worker.cookie,
        "/v1/staff/workforce/documents/" + d.id,
      );
      expect(download.statusCode).toBe(200);
      expect(download.rawPayload.equals(bytes)).toBe(true);
      expect(download.headers["x-content-type-options"]).toBe("nosniff");
      expect(download.headers["content-disposition"]).toContain("attachment");
      expect(
        (await send(manager.cookie, "/v1/staff/workforce/documents/" + d.id))
          .statusCode,
      ).toBe(403);
      expect(
        (await send(al.owner.cookie, "/v1/staff/workforce/documents/" + d.id))
          .statusCode,
      ).toBe(404);
      expect(
        await prisma.auditEvent.count({
          where: { entityId: d.id, action: "WORKFORCE_DOCUMENT_READ" },
        }),
      ).toBe(1);
    });
    it("no-op saves preserve assignment versions and cancellation retains identity/publication until publish", async () => {
      const w = "2030-09-02",
        a = row(worker.membershipId, w);
      const first = await save(manager.cookie, [a], 0, "DRAFT", w);
      expect(first.statusCode, first.body).toBe(200);
      const before = await prisma.scheduleAssignment.findUniqueOrThrow({
        where: { id: a.id },
      });
      const again = await save(
        manager.cookie,
        [a],
        first.json().version,
        "DRAFT",
        w,
      );
      expect(again.statusCode, again.body).toBe(200);
      expect(
        (
          await prisma.scheduleAssignment.findUniqueOrThrow({
            where: { id: a.id },
          })
        ).version,
      ).toBe(before.version);
      const revision = await prisma.scheduleRevision.findFirstOrThrow({
        where: { scheduleId: first.json().id, version: again.json().version },
      });
      expect(revision.changes).toEqual([]);
      const pub = await save(
        manager.cookie,
        [a],
        again.json().version,
        "PUBLISHED",
        w,
      );
      expect(pub.statusCode, pub.body).toBe(200);
      const cancel = await save(
        manager.cookie,
        [],
        pub.json().version,
        "DRAFT",
        w,
      );
      expect(cancel.statusCode, cancel.body).toBe(200);
      expect(
        (
          await prisma.scheduleAssignment.findUniqueOrThrow({
            where: { id: a.id },
          })
        ).cancelledAt,
      ).not.toBeNull();
      let own = await workspace(worker.cookie, w, "2030-09-30");
      expect(
        own.schedules
          .flatMap((s: any) => s.snapshot.assignments)
          .some((x: any) => x.id === a.id),
      ).toBe(true);
      const gone = await save(
        manager.cookie,
        [],
        cancel.json().version,
        "PUBLISHED",
        w,
      );
      expect(gone.statusCode, gone.body).toBe(200);
      own = await workspace(worker.cookie, w, "2030-09-30");
      expect(
        own.schedules
          .flatMap((s: any) => s.snapshot.assignments)
          .some((x: any) => x.id === a.id),
      ).toBe(false);
      expect(
        await prisma.scheduleAssignment.count({ where: { id: a.id } }),
      ).toBe(1);
    });
    it("copies a week to new draft IDs, creates reusable templates and keeps publications immutable", async () => {
      const copied = await send(
        manager.cookie,
        "/v1/staff/workforce/copy-week",
        { from: "2030-08-19", to: "2030-08-26", expectedVersion: 0 },
      );
      expect(copied.statusCode, copied.body).toBe(200);
      expect(copied.json().snapshot.assignments[0].id).not.toBe(id);
      const t = await send(manager.cookie, "/v1/staff/workforce/templates", {
        name: "Evening station",
        station: "BAR",
        startMinute: 1080,
        durationMinutes: 480,
        breakMinutes: 30,
        requiredSkills: [],
      });
      expect(t.statusCode, t.body).toBe(200);
      expect(
        (
          await send(worker.cookie, "/v1/staff/workforce/templates", {
            name: "Forbidden",
            station: "BAR",
            startMinute: 1080,
            durationMinutes: 480,
            breakMinutes: 30,
            requiredSkills: [],
          })
        ).statusCode,
      ).toBe(403);
      const publication =
        await prisma.publishedAssignmentRevision.findFirstOrThrow({
          where: { assignmentId: id },
        });
      await expect(
        prisma.publishedAssignmentRevision.update({
          where: { id: publication.id },
          data: { timezone: "UTC" },
        }),
      ).rejects.toThrow("append-only");
      const events = await prisma.scheduleRevision.findMany({
        where: {
          tenantId: de.owner.tenantId,
          status: "PUBLISHED",
          publicationEvent: {
            not: (await import("@prisma/client")).Prisma.JsonNull,
          },
        },
      });
      expect(JSON.stringify(events)).not.toContain("Synthetic private terms");
    });
  });
