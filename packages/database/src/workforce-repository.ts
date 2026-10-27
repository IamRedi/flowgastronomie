import { enqueueWorkforcePublication } from "./workforce-notification-repository.js";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  assertStaffPermission,
  hasStaffPermission,
  StaffPermissionDeniedError,
  WorkforceError,
  workforceContractAt,
  workforceContractSchema,
  workforceProfileSchema,
  workforceScheduleSchema,
  workforceTemplateSchema,
  workforceInstant,
  workforceLocal,
  workforceWeek,
  workforceToday,
  workforceAddDays,
  workforceDayRange,
  workforceDiff,
  workforceWarnings,
  workforcePublicationEvent,
  workforceAvailabilitySchema,
  assertWorkforceSchedule,
  assertWorkforceProfileWrite,
  assertWorkforceContractDate,
  type WorkforceAssignment,
  type WorkforceInstantAssignment,
  type WorkforceSnapshot,
  type WorkforceScheduleInput,
  type StaffRole,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import type { StaffIdentity } from "./staff-auth-repository.js";
type Tx = Prisma.TransactionClient;
const scope = (s: Pick<StaffIdentity, "tenantId" | "venueId">) => ({
  tenantId: s.tenantId,
  venueId: s.venueId,
});
async function transaction<T>(
  fn: (tx: Tx) => Promise<T>,
  options: {
    isolationLevel?: Prisma.TransactionIsolationLevel;
    timeout?: number;
  } = {},
) {
  try {
    return await prisma.$transaction(fn, options);
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      (e.code === "P2034" || e.code === "P2002")
    )
      throw new WorkforceError(
        "CONFLICT",
        "Concurrent workforce update. Reload before saving.",
      );
    throw e;
  }
}
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const documentSelect = {
  id: true,
  title: true,
  kind: true,
  expiresOn: true,
  filename: true,
  mimeType: true,
  byteLength: true,
  createdAt: true,
} as const;
async function member(tx: Tx, s: StaffIdentity, id: string) {
  const m = await tx.membership.findFirst({
    where: { ...scope(s), id },
    include: {
      user: {
        select: { id: true, displayName: true, email: true, active: true },
      },
      staffProfile: {
        include: {
          contracts: {
            orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
          },
          documents: { select: documentSelect },
          history: { orderBy: { version: "desc" }, take: 100 },
        },
      },
    },
  });
  if (!m)
    throw new WorkforceError(
      "NOT_FOUND",
      "Staff member was not found in this venue.",
    );
  return m;
}
async function venue(tx: Tx, s: StaffIdentity) {
  const v = await tx.venue.findFirst({
    where: { id: s.venueId, tenantId: s.tenantId },
  });
  if (!v) throw new WorkforceError("NOT_FOUND", "Venue was not found.");
  return v;
}
async function lock(tx: Tx, s: StaffIdentity) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`workforce:${s.tenantId}`},0))`;
}
async function audit(
  tx: Tx,
  s: StaffIdentity,
  action: string,
  entityType: string,
  entityId: string,
  metadata: unknown,
) {
  await tx.auditEvent.create({
    data: {
      ...scope(s),
      actorUserId: s.userId,
      actorMembershipId: s.membershipId,
      action,
      entityType,
      entityId,
      metadata: json(metadata),
    },
  });
}
function choices(a: WorkforceInstantAssignment, timezone: string) {
  const determine = (local: string, instant: string) => {
    try {
      workforceInstant(local, timezone);
      return "reject" as const;
    } catch {
      try {
        return workforceInstant(local, timezone, "earlier") ===
          new Date(instant).toISOString()
          ? ("earlier" as const)
          : ("later" as const);
      } catch {
        return "reject" as const;
      }
    }
  };
  return {
    ...a,
    startsAt: new Date(a.startsAt).toISOString(),
    endsAt: new Date(a.endsAt).toISOString(),
    startChoice: determine(a.startsLocal, a.startsAt),
    endChoice: determine(a.endsLocal, a.endsAt),
  };
}
function published(value: unknown): WorkforceSnapshot | null {
  if (!value) return null;
  const v = value as WorkforceSnapshot;
  return {
    ...v,
    assignments: v.assignments.map((a) => choices(a, v.timezone)),
  };
}
export async function publishedAssignments(
  tx: Tx,
  s: Pick<StaffIdentity, "tenantId" | "venueId">,
  venueId = s.venueId,
): Promise<
  {
    after: WorkforceInstantAssignment;
    timezone: string;
    venueName: string;
    revisionId: string;
    publishedAssignmentRevisionId: string;
    scheduleId: string;
  }[]
> {
  const rows = await tx.$queryRaw<
    {
      after: WorkforceInstantAssignment | null;
      timezone: string;
      venueName: string;
      revisionId: string;
      publishedAssignmentRevisionId: string;
      scheduleId: string;
    }[]
  >`SELECT latest.id AS "publishedAssignmentRevisionId",latest."after",latest.timezone,latest."venueName",latest."revisionId",r."scheduleId" FROM (SELECT DISTINCT ON ("assignmentId") id,"after",timezone,"venueName","revisionId" FROM "PublishedAssignmentRevision" WHERE "tenantId"=${s.tenantId} AND "venueId"=${venueId} ORDER BY "assignmentId",sequence DESC) latest JOIN "ScheduleRevision" r ON r.id=latest."revisionId" WHERE latest."after" IS NOT NULL`;
  return rows
    .filter(
      (
        r,
      ): r is {
        after: WorkforceInstantAssignment;
        timezone: string;
        venueName: string;
        revisionId: string;
        publishedAssignmentRevisionId: string;
        scheduleId: string;
      } => r.after !== null,
    )
    .map((r) => ({ ...r, after: choices(r.after, r.timezone) }))
    .sort(
      (a, b) =>
        a.after.startsAt.localeCompare(b.after.startsAt) ||
        a.after.id.localeCompare(b.after.id),
    );
}
function profileView(
  m: Awaited<ReturnType<typeof member>>,
  s: StaffIdentity,
  today: string,
  details = false,
) {
  const p = m.staffProfile,
    privateAllowed = details && (s.role === "OWNER" || s.userId === m.userId);
  const current = workforceContractAt(p?.contracts ?? [], today);
  return {
    membershipId: m.id,
    userId: m.userId,
    displayName: m.user.displayName,
    workEmail: m.user.email,
    role: m.role,
    active: m.active && m.user.active,
    profileId: p?.id ?? null,
    version: p?.version ?? 0,
    workPhone: p?.workPhone ?? null,
    employeeRef: p?.employeeRef ?? null,
    jobTitle: p?.jobTitle ?? "",
    employmentStartedOn: p?.employmentStartedOn ?? null,
    employmentEndedOn: p?.employmentEndedOn ?? null,
    employmentStatus: p?.employmentStatus ?? "ACTIVE",
    stations: p?.stations ?? [],
    skills: p?.skills ?? [],
    recurringAvailability: workforceAvailabilitySchema.parse(
      p?.recurringAvailability ?? [],
    ),
    annualLeaveDays: privateAllowed ? (p?.annualLeaveDays ?? 0) : null,
    targetWeeklyMinutes: current?.weeklyTargetMinutes ?? null,
    targetMonthlyMinutes: current?.monthlyTargetMinutes ?? null,
    canManageHR: s.role === "OWNER",
    ...(privateAllowed
      ? {
          contracts:
            p?.contracts.map(({ terms, ...c }) => ({ ...c, terms })) ?? [],
          documents: p?.documents ?? [],
          history: p?.history ?? [],
        }
      : {}),
  };
}
async function draftSnapshot(
  tx: Tx,
  s: StaffIdentity,
  v: Awaited<ReturnType<typeof venue>>,
  scheduleId: string,
  week: string,
): Promise<WorkforceSnapshot> {
  const assignments = await tx.scheduleAssignment.findMany({
    where: { ...scope(s), scheduleId, cancelledAt: null },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    include: {
      membership: { include: { user: { select: { displayName: true } } } },
    },
  });
  return {
    week,
    timezone: v.timezone,
    venueId: v.id,
    venueName: v.name,
    assignments: assignments.map((a) =>
      choices(
        {
          id: a.id,
          membershipId: a.membershipId,
          userId: a.userId,
          role: a.role,
          displayName: a.membership?.user.displayName ?? "",
          station: a.station,
          startsLocal: workforceLocal(a.startsAt.toISOString(), v.timezone),
          endsLocal: workforceLocal(a.endsAt.toISOString(), v.timezone),
          startsAt: a.startsAt.toISOString(),
          endsAt: a.endsAt.toISOString(),
          startChoice: "reject",
          endChoice: "reject",
          breakMinutes: a.breakMinutes,
          requiredSkills: a.requiredSkills,
          note: a.note,
        },
        v.timezone,
      ),
    ),
  };
}
export function createWorkforceRepository(
  clock: () => Date = () => new Date(),
) {
  const repository = {
    async workspace(s: StaffIdentity, from: string, to: string) {
      assertStaffPermission(s.role, "SCHEDULE_VIEW");
      if (
        to < from ||
        Math.round((Date.parse(to) - Date.parse(from)) / 86400000) > 93
      )
        throw new WorkforceError(
          "INVALID",
          "Choose a range of at most 93 days.",
        );
      return transaction(
        async (tx) => {
          const v = await venue(tx, s),
            today = workforceToday(v.timezone, clock()),
            manager = hasStaffPermission(s.role, "SCHEDULE_MANAGE");
          const members = await tx.membership.findMany({
            where: { ...scope(s), ...(manager ? {} : { id: s.membershipId }) },
            include: {
              user: {
                select: {
                  id: true,
                  displayName: true,
                  email: true,
                  active: true,
                },
              },
              staffProfile: {
                include: {
                  contracts: {
                    orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
                  },
                  documents: { select: documentSelect },
                  history: { orderBy: { version: "desc" }, take: 100 },
                },
              },
            },
            orderBy: { user: { displayName: "asc" } },
          });
          const schedules = await tx.venueSchedule.findMany({
            where: {
              ...scope(s),
              weekStartsOn: {
                gte: new Date(workforceWeek(from) + "T00:00:00Z"),
                lte: new Date(workforceWeek(to) + "T00:00:00Z"),
              },
            },
            orderBy: { weekStartsOn: "asc" },
          });
          const views = [];
          const allPublished = await publishedAssignments(tx, s);
          const visiblePublished = allPublished.filter(
            (r) => r.after.userId === s.userId,
          );
          const todayRange = workforceDayRange(today, v.timezone);
          const todayAssignments = visiblePublished
            .filter(
              (r) =>
                Date.parse(r.after.startsAt) < todayRange.end &&
                Date.parse(r.after.endsAt) > todayRange.start,
            )
            .map((r) => r.after);
          const upcoming = visiblePublished
            .filter((r) => Date.parse(r.after.endsAt) > clock().getTime())
            .sort((a, b) =>
              a.after.startsAt.localeCompare(b.after.startsAt),
            )[0];
          for (const a of schedules) {
            let snapshot = manager
              ? await draftSnapshot(
                  tx,
                  s,
                  v,
                  a.id,
                  a.weekStartsOn.toISOString().slice(0, 10),
                )
              : published(a.publishedSnapshot);
            if (!snapshot) continue;
            if (!manager)
              snapshot = {
                ...snapshot,
                assignments: visiblePublished
                  .filter(
                    (r) =>
                      workforceWeek(r.after.startsLocal.slice(0, 10)) ===
                      snapshot!.week,
                  )
                  .map((r) => r.after),
              };
            views.push({
              id: a.id,
              week: a.weekStartsOn.toISOString().slice(0, 10),
              version: manager ? a.version : a.publishedVersion,
              status: manager ? a.status : "PUBLISHED",
              publishedVersion: a.publishedVersion,
              publishedAt: a.publishedAt,
              snapshot,
            });
          }
          const profiles = members.map((m) => profileView(m, s, today));
          const availability = await tx.staffAvailabilityNote.findMany({
            where: {
              ...scope(s),
              ...(manager ? {} : { membershipId: s.membershipId }),
              startsAt: {
                lt: new Date(workforceAddDays(to, 2) + "T00:00:00Z"),
              },
              endsAt: {
                gt: new Date(workforceAddDays(from, -1) + "T00:00:00Z"),
              },
            },
            orderBy: { startsAt: "asc" },
          });
          const approvedAbsences = await tx.workforceRequest.findMany({
            where: {
              tenantId: s.tenantId,
              userId: { in: members.map((m) => m.userId) },
              kind: "LEAVE",
              status: "APPROVED",
              startsAt: {
                lt: new Date(workforceAddDays(to, 2) + "T00:00:00Z"),
              },
              endsAt: {
                gt: new Date(workforceAddDays(from, -1) + "T00:00:00Z"),
              },
            },
            select: { id: true, userId: true, startsAt: true, endsAt: true },
          });
          const operationalAvailability = [
            ...availability,
            ...approvedAbsences.flatMap((a) =>
              members
                .filter((m) => m.userId === a.userId)
                .map((m) => ({
                  id: "leave:" + a.id,
                  membershipId: m.id,
                  startsAt: a.startsAt,
                  endsAt: a.endsAt,
                  note: "",
                })),
            ),
          ];
          const warnings = manager
            ? workforceWarnings(
                views.flatMap((a) => a.snapshot.assignments),
                profiles,
                operationalAvailability.map((a) => ({
                  ...a,
                  startsAt: a.startsAt.toISOString(),
                  endsAt: a.endsAt.toISOString(),
                })),
              )
            : [];
          const history = manager
            ? await tx.scheduleRevision.findMany({
                where: {
                  ...scope(s),
                  scheduleId: { in: schedules.map((a) => a.id) },
                },
                orderBy: { createdAt: "desc" },
                take: 100,
                select: {
                  id: true,
                  scheduleId: true,
                  version: true,
                  status: true,
                  changes: true,
                  createdAt: true,
                  createdByUserId: true,
                },
              })
            : [];
          const templates = manager
            ? await tx.workforceShiftTemplate.findMany({
                where: scope(s),
                orderBy: { name: "asc" },
              })
            : [];
          return {
            viewer: {
              membershipId: s.membershipId,
              userId: s.userId,
              role: s.role,
              canManage: manager,
            },
            venue: {
              id: v.id,
              name: v.name,
              timezone: v.timezone,
              countryCode: v.countryCode,
              stations: v.workforceStations,
              configVersion: v.workforceConfigVersion,
            },
            today,
            todayAssignments,
            nextShift: upcoming
              ? {
                  ...upcoming.after,
                  timezone: upcoming.timezone,
                  venueName: upcoming.venueName,
                }
              : null,
            profiles,
            schedules: views,
            availability: operationalAvailability,
            warnings,
            history,
            templates,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    },
    async profile(s: StaffIdentity, id: string) {
      if (
        !hasStaffPermission(s.role, "SCHEDULE_MANAGE") &&
        id !== s.membershipId
      )
        throw new StaffPermissionDeniedError(s.role, "SCHEDULE_MANAGE");
      return transaction(async (tx) => {
        const m = await member(tx, s, id);
        if ((s.role === "OWNER" || s.userId === m.userId) && m.staffProfile)
          await audit(
            tx,
            s,
            "WORKFORCE_PRIVATE_PROFILE_READ",
            "StaffProfile",
            m.staffProfile.id,
            { purpose: "employee-profile" },
          );
        return profileView(
          m,
          s,
          workforceToday((await venue(tx, s)).timezone, clock()),
          true,
        );
      });
    },
    async saveProfile(s: StaffIdentity, id: string, value: unknown) {
      const input = workforceProfileSchema.parse(value);
      assertWorkforceProfileWrite(
        s.role,
        id === s.membershipId,
        Object.keys(input),
      );
      await transaction(async (tx) => {
        await lock(tx, s);
        const m = await member(tx, s, id);
        const p = m.staffProfile;
        if ((p?.version ?? 0) !== input.expectedVersion)
          throw new WorkforceError(
            "CONFLICT",
            "The profile changed. Reload before saving.",
          );
        const { displayName, expectedVersion, ...rawChanges } = input;
        const changes = Object.fromEntries(
          Object.entries(rawChanges).filter(([, value]) => value !== undefined),
        ) as Pick<
          Prisma.StaffProfileUncheckedCreateInput,
          | "workPhone"
          | "employeeRef"
          | "jobTitle"
          | "employmentStartedOn"
          | "employmentEndedOn"
          | "employmentStatus"
          | "stations"
          | "skills"
          | "recurringAvailability"
          | "annualLeaveDays"
        >;
        const started =
            "employmentStartedOn" in rawChanges
              ? rawChanges.employmentStartedOn
              : p?.employmentStartedOn,
          ended =
            "employmentEndedOn" in rawChanges
              ? rawChanges.employmentEndedOn
              : p?.employmentEndedOn;
        if (started && ended && ended < started)
          throw new WorkforceError(
            "INVALID",
            "Employment end must follow the start.",
          );
        if (displayName)
          await tx.user.update({
            where: { id: m.userId },
            data: { displayName },
          });
        const saved = await tx.staffProfile.upsert({
          where: { membershipId: m.id },
          create: {
            ...scope(s),
            userId: m.userId,
            membershipId: m.id,
            ...changes,
            version: 1,
          },
          update: { ...changes, version: { increment: 1 } },
        });
        await tx.staffProfileRevision.create({
          data: {
            ...scope(s),
            profileId: saved.id,
            version: saved.version,
            before: json({
              ...p,
              contracts: undefined,
              documents: undefined,
              history: undefined,
              displayName: m.user.displayName,
            }),
            after: json({
              ...saved,
              displayName: displayName ?? m.user.displayName,
            }),
            createdByUserId: s.userId,
          },
        });
        await audit(
          tx,
          s,
          "WORKFORCE_PROFILE_UPDATED",
          "StaffProfile",
          saved.id,
          {
            beforeVersion: p?.version ?? 0,
            afterVersion: saved.version,
            changedFields: Object.keys(input).filter(
              (k) => k !== "expectedVersion",
            ),
          },
        );
      });
      return repository.profile(s, id);
    },
    async addContract(s: StaffIdentity, id: string, value: unknown) {
      assertStaffPermission(s.role, "WORKFORCE_PRIVATE_MANAGE");
      const input = workforceContractSchema.parse(value);
      await transaction(async (tx) => {
        await lock(tx, s);
        const m = await member(tx, s, id);
        const p = m.staffProfile;
        if ((p?.version ?? 0) !== input.expectedVersion)
          throw new WorkforceError("CONFLICT", "The profile changed.");
        const v = await venue(tx, s);
        assertWorkforceContractDate(
          input.effectiveFrom,
          workforceToday(v.timezone, clock()),
          !!p?.contracts.length,
        );
        const profile =
          p ??
          (await tx.staffProfile.create({
            data: { ...scope(s), userId: m.userId, membershipId: m.id },
          }));
        const { expectedVersion, ...data } = input;
        const contract = await tx.staffEmploymentContract.create({
          data: {
            ...scope(s),
            profileId: profile.id,
            ...data,
            version:
              (p?.contracts.reduce((max, c) => Math.max(max, c.version), 0) ??
                0) + 1,
            createdByUserId: s.userId,
          },
        });
        await tx.staffProfile.update({
          where: { id: profile.id },
          data: { version: { increment: 1 } },
        });
        await audit(
          tx,
          s,
          "WORKFORCE_CONTRACT_ADDED",
          "StaffEmploymentContract",
          contract.id,
          {
            profileId: profile.id,
            version: contract.version,
            effectiveFrom: contract.effectiveFrom,
          },
        );
      });
      return repository.profile(s, id);
    },
    async configure(
      s: StaffIdentity,
      expectedVersion: number,
      stations: string[],
    ) {
      assertStaffPermission(s.role, "SCHEDULE_MANAGE");
      if (
        !stations.length ||
        stations.length > 20 ||
        new Set(stations).size !== stations.length
      )
        throw new WorkforceError("INVALID", "Choose 1–20 unique stations.");
      await transaction(async (tx) => {
        await lock(tx, s);
        const v = await venue(tx, s);
        if (v.workforceConfigVersion !== expectedVersion)
          throw new WorkforceError(
            "CONFLICT",
            "Station configuration changed.",
          );
        await tx.venue.update({
          where: { id: v.id },
          data: {
            workforceStations: stations,
            workforceConfigVersion: { increment: 1 },
          },
        });
        await audit(tx, s, "WORKFORCE_STATIONS_UPDATED", "Venue", v.id, {
          stations,
        });
      });
    },
    async addTemplate(s: StaffIdentity, value: unknown) {
      assertStaffPermission(s.role, "SCHEDULE_MANAGE");
      const input = workforceTemplateSchema.parse(value);
      return transaction(async (tx) => {
        const v = await venue(tx, s);
        if (!v.workforceStations.includes(input.station))
          throw new WorkforceError("INVALID", "Choose a configured station.");
        const a = await tx.workforceShiftTemplate.create({
          data: { ...scope(s), ...input },
        });
        await audit(
          tx,
          s,
          "WORKFORCE_TEMPLATE_CREATED",
          "WorkforceShiftTemplate",
          a.id,
          { name: a.name },
        );
        return a;
      });
    },
    async saveSchedule(s: StaffIdentity, value: unknown) {
      assertStaffPermission(s.role, "SCHEDULE_MANAGE");
      const input = workforceScheduleSchema.parse(value);
      try {
        return await transaction(
          (tx) => saveScheduleInTransaction(tx, s, input, [], clock()),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 15000,
          },
        );
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2034"
        )
          throw new WorkforceError(
            "CONFLICT",
            "Concurrent workforce update. Reload before saving.",
          );
        throw e;
      }
    },
    async move(
      s: StaffIdentity,
      sourceWeek: string,
      sourceVersion: number,
      targetVersion: number,
      assignment: WorkforceAssignment,
    ) {
      assertStaffPermission(s.role, "SCHEDULE_MANAGE");
      return transaction(
        async (tx) => {
          await lock(tx, s);
          const v = await venue(tx, s),
            source = await tx.venueSchedule.findFirst({
              where: {
                ...scope(s),
                weekStartsOn: new Date(sourceWeek + "T00:00:00Z"),
              },
            });
          if (!source || source.version !== sourceVersion)
            throw new WorkforceError("CONFLICT", "Source schedule changed.");
          const snapshot = await draftSnapshot(tx, s, v, source.id, sourceWeek);
          if (!snapshot.assignments.some((a) => a.id === assignment.id))
            throw new WorkforceError(
              "NOT_FOUND",
              "Shift not found in source schedule.",
            );
          const targetWeek = workforceWeek(assignment.startsLocal.slice(0, 10));
          if (targetWeek === sourceWeek)
            throw new WorkforceError("INVALID", "Use the current week editor.");
          await saveScheduleInTransaction(
            tx,
            s,
            workforceScheduleSchema.parse({
              week: sourceWeek,
              expectedVersion: sourceVersion,
              status: "DRAFT",
              assignments: snapshot.assignments
                .filter((a) => a.id !== assignment.id)
                .map(workforceAssignmentSchemaForCopy),
            }),
            [],
            clock(),
          );
          const target = await tx.venueSchedule.findFirst({
            where: {
              ...scope(s),
              weekStartsOn: new Date(targetWeek + "T00:00:00Z"),
            },
          });
          if ((target?.version ?? 0) !== targetVersion)
            throw new WorkforceError("CONFLICT", "Target schedule changed.");
          const before = target
            ? await draftSnapshot(tx, s, v, target.id, targetWeek)
            : { assignments: [] };
          return saveScheduleInTransaction(
            tx,
            s,
            workforceScheduleSchema.parse({
              week: targetWeek,
              expectedVersion: targetVersion,
              status: "DRAFT",
              assignments: [
                ...before.assignments.map(workforceAssignmentSchemaForCopy),
                assignment,
              ],
            }),
            [assignment.id],
            clock(),
          );
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000,
        },
      );
    },
    async copyWeek(
      s: StaffIdentity,
      from: string,
      to: string,
      expectedVersion: number,
    ) {
      assertStaffPermission(s.role, "SCHEDULE_MANAGE");
      const previous = await repository.workspace(s, from, from);
      const source = previous.schedules.find((x) => x.week === from);
      if (!source)
        throw new WorkforceError("NOT_FOUND", "No previous schedule to copy.");
      const delta = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
      const { workforceMove } = await import("@flowgastronomie/domain");
      return repository.saveSchedule(s, {
        week: to,
        expectedVersion,
        status: "DRAFT",
        reviewConfirmed: false,
        assignments: source.snapshot.assignments.map((a) => ({
          ...workforceMove(
            workforceAssignmentSchemaForCopy(a),
            workforceAddDays(a.startsLocal.slice(0, 10), delta),
            a.membershipId,
          ),
          id: randomUUID(),
        })),
      });
    },
  };
  return repository;
}
export const workforceRepository = createWorkforceRepository();

function workforceAssignmentSchemaForCopy(
  a: WorkforceInstantAssignment,
): WorkforceAssignment {
  const { userId, role, displayName, startsAt, endsAt, ...b } = a;
  return b;
}

export async function saveScheduleInTransaction(
  tx: Tx,
  s: StaffIdentity,
  input: WorkforceScheduleInput,
  transferIds: string[] = [],
  now: Date = new Date(),
) {
  assertStaffPermission(s.role, "SCHEDULE_MANAGE");
  await lock(tx, s);
  const v = await venue(tx, s),
    weekStartsOn = new Date(input.week + "T00:00:00Z");
  let schedule = await tx.venueSchedule.findFirst({
    where: { ...scope(s), weekStartsOn },
  });
  if ((schedule?.version ?? 0) !== input.expectedVersion)
    throw new WorkforceError(
      "CONFLICT",
      "Another manager changed the schedule. Reload to keep their changes.",
    );
  const before = schedule
    ? await draftSnapshot(tx, s, v, schedule.id, input.week)
    : {
        week: input.week,
        timezone: v.timezone,
        venueId: v.id,
        venueName: v.name,
        assignments: [],
      };
  const lastPublished = published(schedule?.publishedSnapshot);
  const globalPublished = await publishedAssignments(tx, s);
  const publicationBefore = [
    ...globalPublished
      .filter(
        (r) =>
          r.scheduleId === schedule?.id ||
          input.assignments.some((a) => a.id === r.after.id),
      )
      .map((r) => r.after),
  ];
  const members = await tx.membership.findMany({
    where: {
      ...scope(s),
      id: {
        in: input.assignments.flatMap((a) =>
          a.membershipId ? [a.membershipId] : [],
        ),
      },
    },
    include: {
      user: { select: { displayName: true, active: true } },
      staffProfile: true,
    },
  });
  const resolved: WorkforceInstantAssignment[] = input.assignments
    .map((a) => {
      const m = members.find((m) => m.id === a.membershipId),
        old = before.assignments.find((x) => x.id === a.id);
      const past =
        !!old && old.startsLocal.slice(0, 10) < workforceToday(v.timezone, now);
      if (a.membershipId && (!m || (!past && (!m.active || !m.user.active))))
        throw new WorkforceError(
          "NOT_FOUND",
          "Staff member is unavailable in this venue.",
        );
      if (!v.workforceStations.includes(a.station))
        throw new WorkforceError(
          "INVALID",
          "Choose a configured work station.",
        );
      if (
        !past &&
        m?.staffProfile &&
        (m.staffProfile.employmentStatus === "ENDED" ||
          (m.staffProfile.employmentStartedOn &&
            a.startsLocal.slice(0, 10) < m.staffProfile.employmentStartedOn) ||
          (m.staffProfile.employmentEndedOn &&
            a.startsLocal.slice(0, 10) > m.staffProfile.employmentEndedOn))
      )
        throw new WorkforceError(
          "INVALID",
          "Shift is outside the employment dates.",
        );
      const same = old && old.membershipId === a.membershipId;
      return {
        ...a,
        userId: m?.userId ?? null,
        role: same ? old.role : (m?.role ?? "WAITER"),
        displayName: same ? old.displayName : (m?.user.displayName ?? ""),
        startsAt:
          old &&
          old.startsLocal === a.startsLocal &&
          old.startChoice === a.startChoice
            ? old.startsAt
            : workforceInstant(a.startsLocal, v.timezone, a.startChoice),
        endsAt:
          old && old.endsLocal === a.endsLocal && old.endChoice === a.endChoice
            ? old.endsAt
            : workforceInstant(a.endsLocal, v.timezone, a.endChoice),
      };
    })
    .sort(
      (a, b) =>
        a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id),
    );
  assertWorkforceSchedule(
    input,
    resolved,
    before.assignments,
    workforceToday(v.timezone, now),
  );
  const foreignIds = await tx.scheduleAssignment.count({
    where: {
      id: { in: resolved.map((a) => a.id), notIn: transferIds },
      ...(schedule ? { NOT: { ...scope(s), scheduleId: schedule.id } } : {}),
    },
  });
  if (foreignIds)
    throw new WorkforceError(
      "NOT_FOUND",
      "An assignment belongs to another schedule.",
    );
  // Serialize at tenant level: one user may hold memberships at several venues.
  const external = await tx.venueSchedule.findMany({
    where: {
      tenantId: s.tenantId,
      ...(schedule ? { id: { not: schedule.id } } : {}),
    },
    include: { assignments: { where: { cancelledAt: null } } },
  });
  const externalPublication = new Map<
    string,
    Awaited<ReturnType<typeof publishedAssignments>>
  >();
  for (const id of new Set(external.map((e) => e.venueId)))
    externalPublication.set(
      id,
      id === s.venueId
        ? globalPublished
        : await publishedAssignments(tx, s, id),
    );
  for (const other of external) {
    const occupied = [
      ...other.assignments.map((a) => ({
        id: a.id,
        userId: a.userId,
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
      })),
      ...(externalPublication.get(other.venueId) ?? [])
        .filter((r) => r.scheduleId !== schedule?.id)
        .map((r) => r.after),
    ];
    for (const a of resolved)
      if (
        a.userId &&
        occupied.some(
          (b) =>
            b.id !== a.id &&
            b.userId === a.userId &&
            a.startsAt < b.endsAt &&
            b.startsAt < a.endsAt,
        )
      )
        throw new WorkforceError(
          "CONFLICT",
          "This person has an overlapping shift in another week or venue.",
        );
  }
  const version = (schedule?.version ?? 0) + 1,
    publishing = input.status === "PUBLISHED",
    snapshot: WorkforceSnapshot = { ...before, assignments: resolved };
  const warnings = workforceWarnings(
    resolved,
    members.map((m) => ({
      membershipId: m.id,
      skills: m.staffProfile?.skills ?? [],
      stations: m.staffProfile?.stations ?? [],
      recurringAvailability: workforceAvailabilitySchema.parse(
        m.staffProfile?.recurringAvailability ?? [],
      ),
    })),
    (
      await tx.staffAvailabilityNote.findMany({
        where: {
          ...scope(s),
          membershipId: { in: members.map((m) => m.id) },
        },
      })
    ).map((n) => ({
      ...n,
      startsAt: n.startsAt.toISOString(),
      endsAt: n.endsAt.toISOString(),
    })),
  );
  schedule = await tx.venueSchedule.upsert({
    where: {
      venueId_weekStartsOn: { venueId: s.venueId, weekStartsOn },
    },
    create: {
      ...scope(s),
      weekStartsOn,
      status: input.status,
      version,
      ...(publishing
        ? {
            publishedSnapshot: json(snapshot),
            publishedVersion: version,
            publishedAt: now,
            publishedByUserId: s.userId,
          }
        : {}),
    },
    update: {
      status: input.status,
      version,
      ...(publishing
        ? {
            publishedSnapshot: json(snapshot),
            publishedVersion: version,
            publishedAt: now,
            publishedByUserId: s.userId,
          }
        : {}),
    },
  });
  await tx.scheduleAssignment.updateMany({
    where: {
      ...scope(s),
      scheduleId: schedule.id,
      cancelledAt: null,
      id: { notIn: resolved.map((a) => a.id) },
    },
    data: { cancelledAt: now, version: { increment: 1 } },
  });
  for (const a of resolved) {
    const data = {
      membershipId: a.membershipId,
      userId: a.userId,
      role: a.role,
      station: a.station,
      startsAt: new Date(a.startsAt),
      endsAt: new Date(a.endsAt),
      breakMinutes: a.breakMinutes,
      requiredSkills: a.requiredSkills,
      note: a.note,
      cancelledAt: null,
    };
    const exists = await tx.scheduleAssignment.findFirst({
      where: { ...scope(s), id: a.id },
    });
    if (
      exists &&
      workforceDiff(
        before.assignments.filter((b) => b.id === a.id),
        [a],
      ).length === 0 &&
      exists.scheduleId === schedule.id &&
      !exists.cancelledAt
    )
      continue;
    if (exists)
      await tx.scheduleAssignment.update({
        where: { id: exists.id },
        data: { ...data, scheduleId: schedule.id, version: { increment: 1 } },
      });
    else
      await tx.scheduleAssignment.create({
        data: {
          id: a.id,
          ...scope(s),
          scheduleId: schedule.id,
          ...data,
        },
      });
  }
  const event = publishing
    ? workforcePublicationEvent(
        {
          eventId: `${schedule.id}:${version}`,
          type: lastPublished ? "SCHEDULE_REPUBLISHED" : "SCHEDULE_PUBLISHED",
          tenantId: s.tenantId,
          venueId: s.venueId,
          scheduleId: schedule.id,
          version,
          actorUserId: s.userId,
          occurredAt: now.toISOString(),
        },
        publicationBefore,
        resolved,
      )
    : null;
  const revision = await tx.scheduleRevision.create({
    data: {
      ...scope(s),
      scheduleId: schedule.id,
      version,
      status: input.status,
      before: json(before),
      after: json(snapshot),
      changes: json(workforceDiff(before.assignments, resolved)),
      ...(event ? { publicationEvent: json(event) } : {}),
      createdByUserId: s.userId,
    },
  });
  if (publishing)
    for (const change of workforceDiff(publicationBefore, resolved)) {
      // A late publication of the source week must not remove a shift already moved/published elsewhere.
      const latest = globalPublished.find((r) => r.after.id === change.id);
      const latestRevision = latest
        ? await tx.scheduleRevision.findUnique({
            where: { id: latest.revisionId },
            select: { scheduleId: true },
          })
        : null;
      if (
        !change.after &&
        latestRevision &&
        latestRevision.scheduleId !== schedule.id
      )
        continue;
      await tx.publishedAssignmentRevision.create({
        data: {
          ...scope(s),
          assignmentId: change.id,
          revisionId: revision.id,
          before: change.before ? json(change.before) : Prisma.DbNull,
          after: change.after ? json(change.after) : Prisma.DbNull,
          timezone: v.timezone,
          venueName: v.name,
        },
      });
    }
  if (event) await enqueueWorkforcePublication(tx, event);
  await audit(
    tx,
    s,
    publishing ? "SCHEDULE_PUBLISHED" : "SCHEDULE_SAVED",
    "VenueSchedule",
    schedule.id,
    {
      version,
      week: input.week,
      assignmentCount: resolved.length,
      warningCount: warnings.length,
      eventId: event?.eventId ?? null,
    },
  );
  return {
    id: schedule.id,
    week: input.week,
    version,
    status: input.status,
    snapshot,
    publishedVersion: schedule.publishedVersion,
    warnings,
    changes: workforceDiff(publicationBefore, resolved),
  };
}
