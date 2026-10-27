import { reconcileWorkforceClosedAccounts } from "./workforce-account-repository.js";
import { enqueueWorkforceOperationIntent } from "./workforce-notification-repository.js";
import {
  requireWorkforceActor as actor,
  lockWorkforceTenant as lock,
  appendWorkforceAudit as audit,
} from "./workforce-transaction.js";
import {
  workforceAttendanceEvidence as evidence,
  workforceCurrentApproval as approved,
  workforceAttendanceProjection as attendanceView,
  workforceAttendanceInclude as includeAttendance,
  type WorkforceAttendanceRecord as Attendance,
} from "./workforce-attendance-projection.js";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  assertStaffPermission,
  hasStaffPermission,
  StaffPermissionDeniedError,
  WorkforceError,
  workforceToday,
  workforceAddDays,
  workforceDayRange,
  workforceWeek,
  workforceContractAt,
  workforceAvailabilitySchema,
  assertWorkforceLeaveAllowance,
  assertWorkforcePolicyDate,
  assertWorkforceCorrectionPeriod,
  workforceRequestActions,
  workforceDefaultRules,
  workforcePolicyRulesSchema,
  workforcePolicyAt,
  workforcePolicyWriteSchema,
  workforcePunchSchema,
  assertAttendanceTransition,
  workforceAttendanceState,
  workforceOriginalAttendance,
  workforceAttendanceTotals,
  workforceAttendanceWarnings,
  workforceCorrectionSchema,
  workforceCorrectionSnapshot,
  assertIndependentWorkforceReview,
  workforceLeaveSchema,
  workforceLeaveSlices,
  workforceLeaveGrantSchema,
  workforceShiftRequestSchema,
  workforceRequestDecisionSchema,
  workforceRequestTransition,
  assertWorkforceShiftEligibility,
  workforceShiftRestWarnings,
  type AttendanceSnapshot,
  type AttendanceEvidence,
  type WorkforcePolicyVersion,
  type LeaveSlice,
  type WorkforceInstantAssignment,
  type WorkforceRequestStatus,
  type WorkforceOperationsIntentV1,
  type WorkforceApprovedAttendanceV1,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import {
  publishedAssignments,
  saveScheduleInTransaction,
} from "./workforce-repository.js";
import type { StaffIdentity } from "./staff-auth-repository.js";
type Tx = Prisma.TransactionClient;
type Request = Prisma.WorkforceRequestGetPayload<{
  include: { transitions: true };
}>;
const scope = (s: StaffIdentity) => ({
  tenantId: s.tenantId,
  venueId: s.venueId,
});
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const includeRequest = {
  transitions: { orderBy: { version: "asc" as const } },
};
const missing = (message = "Record was not found in this venue.") =>
  new WorkforceError("NOT_FOUND", message);
async function mutate<T>(s: StaffIdentity, fn: (tx: Tx) => Promise<T>) {
  assertStaffPermission(s.role, "SCHEDULE_VIEW");
  try {
    return await prisma.$transaction(
      async (tx) => {
        await lock(tx, s);
        await actor(tx, s);
        return fn(tx);
      },
      { timeout: 20000 },
    );
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2034", "P2002"].includes(e.code)
    )
      throw new WorkforceError(
        "CONFLICT",
        "Concurrent workforce update. Reload and retry safely.",
      );
    throw e;
  }
}
async function context(
  tx: Tx,
  s: StaffIdentity,
  membershipId = s.membershipId,
) {
  const member = await tx.membership.findFirst({
    where: { ...scope(s), id: membershipId },
    include: {
      user: { select: { id: true, displayName: true, active: true } },
      staffProfile: {
        include: {
          contracts: {
            select: {
              id: true,
              version: true,
              effectiveFrom: true,
              weeklyTargetMinutes: true,
              countryCode: true,
            },
            orderBy: { version: "desc" },
          },
        },
      },
    },
  });
  const venue = await tx.venue.findFirst({
    where: { tenantId: s.tenantId, id: s.venueId },
  });
  if (!member?.staffProfile || !venue) throw missing();
  return { member, profile: member.staffProfile, venue };
}
function policyVersions(
  rows: {
    id: string;
    version: number;
    effectiveFrom: string;
    countryCode: string;
    rules: Prisma.JsonValue;
  }[],
): WorkforcePolicyVersion[] {
  return rows.map((p) => ({
    id: p.id,
    version: p.version,
    effectiveFrom: p.effectiveFrom,
    countryCode: p.countryCode,
    rules: workforcePolicyRulesSchema.parse(p.rules),
  }));
}
async function policy(
  tx: Tx,
  s: StaffIdentity,
  country: string,
  date: string,
  now: Date,
) {
  if (!["DE", "AL"].includes(country))
    throw new WorkforceError(
      "INVALID",
      "Configure a DE or AL employment policy first.",
    );
  let rows = await tx.workforcePolicy.findMany({
    where: { ...scope(s), countryCode: country },
    orderBy: { version: "desc" },
  });
  if (!rows.length) {
    const venue = await tx.venue.findFirstOrThrow({
      where: { tenantId: s.tenantId, id: s.venueId },
    });
    const baseline = await tx.workforcePolicy.create({
      data: {
        ...scope(s),
        version: 1,
        effectiveFrom: workforceToday(venue.timezone, venue.createdAt),
        countryCode: country,
        rules: json(workforceDefaultRules(country)),
        reason: "Initial configurable baseline; legal review required",
        createdByUserId: s.userId,
        createdAt: now,
      },
    });
    rows = [baseline];
  }
  return workforcePolicyAt(policyVersions(rows), date);
}
async function managers(tx: Tx, s: StaffIdentity) {
  return (
    await tx.membership.findMany({
      where: {
        ...scope(s),
        active: true,
        role: { in: ["OWNER", "MANAGER"] },
        user: { active: true },
      },
      select: { userId: true },
    })
  ).map((m) => m.userId);
}
async function intent(
  tx: Tx,
  s: StaffIdentity,
  type: string,
  subjectId: string,
  recipients: string[],
  now: Date,
) {
  const id = randomUUID(),
    a = await audit(tx, s, type, subjectId, now);
  const payload: WorkforceOperationsIntentV1 = {
    schemaVersion: 1,
    eventId: id,
    type,
    ...scope(s),
    subjectId,
    actorUserId: s.userId,
    occurredAt: now.toISOString(),
    recipientUserIds: [...new Set(recipients)],
    permission: "WORKFORCE_SELF_OR_VENUE_MANAGER",
    auditEventId: a.id,
  };
  const storedIntent = await tx.workforceEventIntent.create({
    data: {
      id,
      ...scope(s),
      type,
      subjectId,
      actorUserId: s.userId,
      recipientUserIds: payload.recipientUserIds,
      payload: json(payload),
      createdAt: now,
    },
  });
  await enqueueWorkforceOperationIntent(tx, storedIntent);
}
function ownOrManager(s: StaffIdentity, userId: string) {
  if (s.userId !== userId && !hasStaffPermission(s.role, "SCHEDULE_MANAGE"))
    throw new StaffPermissionDeniedError(s.role, "SCHEDULE_MANAGE");
}
function requestView(r: Request) {
  return {
    id: r.id,
    userId: r.userId,
    membershipId: r.membershipId,
    kind: r.kind,
    status: r.status,
    version: r.version,
    payload: r.payload,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    contractRevisionId: r.contractRevisionId,
    policyRevisionId: r.policyRevisionId,
    invitedUserId: r.invitedUserId,
    createdAt: r.createdAt.toISOString(),
    transitions: r.transitions.map((t) => ({
      id: t.id,
      version: t.version,
      action: t.action,
      fromStatus: t.fromStatus,
      toStatus: t.toStatus,
      actorUserId: t.actorUserId,
      reason: t.reason,
      result: t.result,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}
async function requestRetry(
  tx: Tx,
  s: StaffIdentity,
  key: string,
  body: unknown,
) {
  const r = await tx.workforceRequest.findFirst({
    where: { tenantId: s.tenantId, userId: s.userId, idempotencyKey: key },
    include: includeRequest,
  });
  if (r && (r.venueId !== s.venueId || r.requestHash !== hash(body)))
    throw new WorkforceError(
      "CONFLICT",
      "Idempotency key belongs to a different request.",
    );
  return r ? requestView(r) : null;
}
async function overlapsAbsence(
  tx: Tx,
  s: StaffIdentity,
  userId: string,
  start: string,
  end: string,
  excludeId?: string,
) {
  return tx.workforceRequest.findMany({
    where: {
      tenantId: s.tenantId,
      userId,
      kind: "LEAVE",
      status: "APPROVED",
      startsAt: { lt: new Date(end) },
      endsAt: { gt: new Date(start) },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}
async function createRequest(
  tx: Tx,
  s: StaffIdentity,
  data: {
    kind: string;
    target?: { userId: string; membershipId: string };
    payload: unknown;
    startsAt: string;
    endsAt: string;
    contractRevisionId: string | null;
    policyRevisionId: string;
    invitedUserId?: string | null;
    idempotencyKey: string;
    requestHash: string;
    profileId: string;
  },
  now: Date,
) {
  const { payload, target, ...rest } = data;
  const r = await tx.workforceRequest.create({
    data: {
      ...scope(s),
      userId: target?.userId ?? s.userId,
      membershipId: target?.membershipId ?? s.membershipId,
      ...rest,
      payload: json(payload),
      createdAt: now,
    },
  });
  await tx.workforceRequestTransition.create({
    data: {
      ...scope(s),
      requestId: r.id,
      version: 0,
      fromStatus: null,
      toStatus: "PENDING",
      action: "REQUEST",
      actorUserId: s.userId,
      reason: "",
      result: { schemaVersion: 1 },
      createdAt: now,
    },
  });
  await intent(
    tx,
    s,
    r.kind + "_REQUESTED",
    r.id,
    [...(await managers(tx, s)), ...(r.invitedUserId ? [r.invitedUserId] : [])],
    now,
  );
  return requestView(
    await tx.workforceRequest.findUniqueOrThrow({
      where: { id: r.id },
      include: includeRequest,
    }),
  );
}
async function balance(tx: Tx, s: StaffIdentity, userId: string, year: number) {
  const grants = await tx.workforceLeaveGrant.findMany({
    where: { ...scope(s), userId, year },
    orderBy: { version: "asc" },
  });
  const requests = await tx.workforceRequest.findMany({
    where: {
      ...scope(s),
      userId,
      kind: "LEAVE",
      status: { in: ["APPROVED", "PENDING"] },
    },
  });
  let used = 0,
    reserved = 0;
  for (const r of requests) {
    const p = r.payload as { category: string; slices: LeaveSlice[] };
    if (p.category !== "ANNUAL") continue;
    const minutes = p.slices
      .filter((d) => d.year === year)
      .reduce((n, d) => n + d.chargedMinutes, 0);
    if (r.status === "APPROVED") used += minutes;
    else reserved += minutes;
  }
  const allowance = grants.reduce((n, g) => n + g.minutes, 0);
  return {
    year,
    configured: grants.length > 0,
    version: grants.length ? grants[grants.length - 1]!.version : 0,
    allowanceMinutes: grants.length ? allowance : null,
    usedMinutes: used,
    pendingMinutes: reserved,
    remainingMinutes: grants.length ? allowance - used : null,
    history: grants.map((g) => ({
      id: g.id,
      version: g.version,
      minutes: g.minutes,
      reason: g.reason,
      contractRevisionId: g.contractRevisionId,
      policyRevisionId: g.policyRevisionId,
      actorUserId: g.actorUserId,
      createdAt: g.createdAt.toISOString(),
    })),
  };
}
export function createWorkforceOperationsRepository(
  clock: () => Date = () => new Date(),
) {
  return {
    async punch(s: StaffIdentity, value: unknown) {
      const b = workforcePunchSchema.parse(value);
      return mutate(s, async (tx) => {
        const retry = await tx.workforceAttendanceEvent.findFirst({
          where: {
            tenantId: s.tenantId,
            userId: s.userId,
            idempotencyKey: b.idempotencyKey,
          },
        });
        if (retry) {
          if (retry.venueId !== s.venueId || retry.requestHash !== hash(b))
            throw new WorkforceError(
              "CONFLICT",
              "Clock retry key belongs to a different action.",
            );
          return {
            attendanceId: retry.attendanceId,
            eventId: retry.id,
            version: retry.sequence,
            occurredAt: retry.occurredAt.toISOString(),
          };
        }
        const now = clock(),
          c = await context(tx, s),
          date = workforceToday(c.venue.timezone, now),
          contract = workforceContractAt(c.profile.contracts, date);
        let a = await tx.workforceAttendance.findFirst({
          where: {
            tenantId: s.tenantId,
            userId: s.userId,
            state: { not: "CLOSED" },
          },
          include: includeAttendance,
        });
        if (a && workforceAttendanceState(evidence(a)) !== a.state)
          throw new WorkforceError(
            "INVALID",
            "Attendance projection does not match immutable evidence. Independent recovery is required.",
          );
        if (a && a.venueId !== s.venueId)
          throw new WorkforceError(
            "CONFLICT",
            "Finish or recover your active attendance at the other venue first.",
          );
        if ((a?.version ?? 0) !== b.expectedVersion)
          throw new WorkforceError(
            "CONFLICT",
            "Work status changed. Reload before punching.",
          );
        assertAttendanceTransition(
          (a?.state as "WORKING" | "BREAK" | null) ?? null,
          b.kind,
        );
        if (
          b.kind !== "CLOCK_IN" &&
          (b.assignmentId || b.operationalStaffShiftId)
        )
          throw new WorkforceError(
            "INVALID",
            "Work links belong to clock-in only.",
          );
        if (
          !a &&
          (!c.member.active ||
            !c.member.user.active ||
            c.profile.employmentStatus === "ENDED" ||
            (c.profile.employmentStartedOn &&
              date < c.profile.employmentStartedOn) ||
            (c.profile.employmentEndedOn && date > c.profile.employmentEndedOn))
        )
          throw new WorkforceError(
            "INVALID",
            "Attendance is outside active employment dates.",
          );
        const p = a
          ? policyVersions([
              await tx.workforcePolicy.findFirstOrThrow({
                where: { ...scope(s), id: a.policyRevisionId },
              }),
            ])[0]!
          : await policy(
              tx,
              s,
              contract?.countryCode ?? c.venue.countryCode ?? "",
              date,
              now,
            );
        const rules = p.rules;
        if (
          b.kind === "BREAK_START" &&
          b.breakKind === "PAID" &&
          !rules.paidBreaksAllowed
        )
          throw new WorkforceError(
            "INVALID",
            "Paid breaks are not enabled by this attendance policy.",
          );
        if (b.kind !== "BREAK_START" && b.breakKind)
          throw new WorkforceError(
            "INVALID",
            "Break category belongs to break start only.",
          );
        if (a && a.events.length >= 1000)
          throw new WorkforceError(
            "INVALID",
            "Recover this attendance session before recording more events.",
          );
        if (a && a.events.some((e) => e.occurredAt > now))
          throw new WorkforceError(
            "TIME",
            "Server clock moved backwards; retry after time recovery.",
          );
        let unscheduled = false;
        if (!a) {
          const rows = await publishedAssignments(tx, s);
          const row = b.assignmentId
            ? rows.find((r) => r.after.id === b.assignmentId)
            : rows.find(
                (r) =>
                  r.after.userId === s.userId &&
                  Date.parse(r.after.startsAt) <= now.getTime() + 3600000 &&
                  Date.parse(r.after.endsAt) > now.getTime(),
              );
          if (
            b.assignmentId &&
            (!row ||
              row.after.userId !== s.userId ||
              Date.parse(row.after.startsAt) > now.getTime() + 3600000 ||
              Date.parse(row.after.endsAt) < now.getTime())
          )
            throw missing("Select your current published shift.");
          if (
            b.operationalStaffShiftId &&
            !(await tx.staffShift.findFirst({
              where: {
                ...scope(s),
                id: b.operationalStaffShiftId,
                userId: s.userId,
                membershipId: s.membershipId,
              },
            }))
          )
            throw missing("Operational POS session was not found.");
          a = await tx.workforceAttendance.create({
            data: {
              ...scope(s),
              userId: s.userId,
              membershipId: s.membershipId,
              profileId: c.profile.id,
              timezone: c.venue.timezone,
              contractRevisionId: contract?.id ?? null,
              policyRevisionId: p.id,
              publishedAssignmentRevisionId:
                row?.publishedAssignmentRevisionId ?? null,
              operationalStaffShiftId: b.operationalStaffShiftId ?? null,
              state: "WORKING",
              version: 1,
              startedAt: now,
              recordedAt: now,
            },
            include: includeAttendance,
          });
          unscheduled = !row;
        } else
          a = await tx.workforceAttendance.update({
            where: { id: a.id },
            data: {
              state:
                b.kind === "CLOCK_OUT"
                  ? "CLOSED"
                  : b.kind === "BREAK_START"
                    ? "BREAK"
                    : "WORKING",
              version: { increment: 1 },
            },
            include: includeAttendance,
          });
        const e = await tx.workforceAttendanceEvent.create({
          data: {
            ...scope(s),
            userId: s.userId,
            attendanceId: a.id,
            sequence: a.version,
            kind: b.kind,
            occurredAt: now,
            recordedAt: now,
            actorUserId: s.userId,
            idempotencyKey: b.idempotencyKey,
            requestHash: hash(b),
            payload: {
              ...(b.kind === "BREAK_START"
                ? { breakKind: b.breakKind ?? "UNPAID" }
                : {}),
              ...(b.kind === "CLOCK_IN"
                ? { unscheduled, contractMissing: !contract }
                : {}),
            },
          },
        });
        await audit(tx, s, b.kind, a.id, now);
        if (b.kind === "CLOCK_OUT")
          await intent(
            tx,
            s,
            "ATTENDANCE_REVIEW_REQUIRED",
            a.id,
            [s.userId, ...(await managers(tx, s))],
            now,
          );
        if (unscheduled || (!contract && b.kind === "CLOCK_IN"))
          await intent(
            tx,
            s,
            "CLOCK_EXCEPTION",
            a.id,
            await managers(tx, s),
            now,
          );
        return {
          attendanceId: a.id,
          eventId: e.id,
          version: a.version,
          occurredAt: now.toISOString(),
        };
      });
    },
    async requestCorrection(s: StaffIdentity, value: unknown) {
      const b = workforceCorrectionSchema.parse(value);
      return mutate(s, async (tx) => {
        const retry = await requestRetry(tx, s, b.idempotencyKey, b);
        if (retry) return retry;
        const now = clock(),
          c = await context(tx, s);
        const a = b.attendanceId
          ? await tx.workforceAttendance.findFirst({
              where: { ...scope(s), id: b.attendanceId, userId: s.userId },
              include: includeAttendance,
            })
          : null;
        if (b.attendanceId && !a) throw missing();
        if ((a?.version ?? 0) !== b.expectedAttendanceVersion)
          throw new WorkforceError(
            "CONFLICT",
            "Attendance changed. Reload the original evidence.",
          );
        if (!a && b.reason !== "MISSING_IN")
          throw new WorkforceError(
            "INVALID",
            "A missing clock-in must explicitly identify that exception.",
          );
        const timezone = a?.timezone ?? c.venue.timezone,
          snapshot = workforceCorrectionSnapshot(b, timezone);
        assertWorkforceCorrectionPeriod(snapshot, now.toISOString());
        const date = workforceToday(timezone, new Date(snapshot.startsAt)),
          contract = workforceContractAt(c.profile.contracts, date),
          p = await policy(
            tx,
            s,
            contract?.countryCode ?? c.venue.countryCode ?? "",
            date,
            now,
          );
        if (
          snapshot.breaks.some((x) => x.kind === "PAID") &&
          !p.rules.paidBreaksAllowed
        )
          throw new WorkforceError(
            "INVALID",
            "Paid breaks are not configured.",
          );
        return createRequest(
          tx,
          s,
          {
            kind: "CORRECTION",
            profileId: c.profile.id,
            payload: {
              snapshot,
              attendanceId: a?.id ?? null,
              attendanceVersion: b.expectedAttendanceVersion,
              exceptionReason: b.reason,
              timezone,
            },
            startsAt: snapshot.startsAt,
            endsAt: snapshot.endsAt,
            contractRevisionId: contract?.id ?? null,
            policyRevisionId: p.id,
            idempotencyKey: b.idempotencyKey,
            requestHash: hash(b),
          },
          now,
        );
      });
    },
    async recoveryRequest(s: StaffIdentity, id: string, value: unknown) {
      assertStaffPermission(s.role, "SCHEDULE_MANAGE");
      const b = workforceCorrectionSchema.parse(value);
      return mutate(s, async (tx) => {
        const a = await tx.workforceAttendance.findFirst({
          where: { ...scope(s), id },
          include: includeAttendance,
        });
        if (!a) throw missing();
        if (b.attendanceId !== id)
          throw new WorkforceError(
            "INVALID",
            "Recovery must reference its original attendance.",
          );
        const requestHash = hash({ body: b, actorUserId: s.userId }),
          retry = await tx.workforceRequest.findFirst({
            where: {
              tenantId: s.tenantId,
              userId: a.userId,
              idempotencyKey: b.idempotencyKey,
            },
            include: includeRequest,
          });
        if (retry) {
          if (retry.venueId !== s.venueId || retry.requestHash !== requestHash)
            throw new WorkforceError(
              "CONFLICT",
              "Recovery retry key conflicts.",
            );
          return requestView(retry);
        }
        if (a.version !== b.expectedAttendanceVersion)
          throw new WorkforceError(
            "CONFLICT",
            "Original evidence changed before recovery.",
          );
        const now = clock(),
          snapshot = workforceCorrectionSnapshot(b, a.timezone);
        assertWorkforceCorrectionPeriod(snapshot, now.toISOString());
        const p = await tx.workforcePolicy.findFirstOrThrow({
          where: { ...scope(s), id: a.policyRevisionId },
        });
        if (
          snapshot.breaks.some((x) => x.kind === "PAID") &&
          !workforcePolicyRulesSchema.parse(p.rules).paidBreaksAllowed
        )
          throw new WorkforceError(
            "INVALID",
            "Paid breaks are not configured for this original attendance.",
          );
        return createRequest(
          tx,
          s,
          {
            kind: "CORRECTION",
            target: { userId: a.userId, membershipId: a.membershipId },
            profileId: a.profileId,
            payload: {
              snapshot,
              attendanceId: a.id,
              attendanceVersion: a.version,
              exceptionReason: b.reason,
              timezone: a.timezone,
              managerRecovery: true,
            },
            startsAt: snapshot.startsAt,
            endsAt: snapshot.endsAt,
            contractRevisionId: a.contractRevisionId,
            policyRevisionId: a.policyRevisionId,
            idempotencyKey: b.idempotencyKey,
            requestHash,
          },
          now,
        );
      });
    },
    async requestLeave(s: StaffIdentity, value: unknown) {
      const b = workforceLeaveSchema.parse(value);
      return mutate(s, async (tx) => {
        const retry = await requestRetry(tx, s, b.idempotencyKey, b);
        if (retry) return retry;
        const now = clock(),
          c = await context(tx, s),
          country =
            workforceContractAt(c.profile.contracts, b.from)?.countryCode ??
            c.venue.countryCode ??
            "";
        await policy(tx, s, country, b.from, now);
        const policies = policyVersions(
          await tx.workforcePolicy.findMany({
            where: { ...scope(s), countryCode: country },
          }),
        );
        const slices = workforceLeaveSlices(
            b,
            c.venue.timezone,
            c.profile.contracts,
            policies,
          ),
          first = slices[0]!,
          last = slices[slices.length - 1]!;
        const existing = await tx.workforceRequest.findMany({
          where: {
            tenantId: s.tenantId,
            userId: s.userId,
            kind: "LEAVE",
            status: { in: ["PENDING", "APPROVED"] },
            startsAt: { lt: new Date(last.endsAt) },
            endsAt: { gt: new Date(first.startsAt) },
          },
        });
        if (existing.length)
          throw new WorkforceError(
            "CONFLICT",
            "Another pending or approved absence overlaps this period.",
          );
        return createRequest(
          tx,
          s,
          {
            kind: "LEAVE",
            profileId: c.profile.id,
            payload: {
              category: b.category,
              from: b.from,
              to: b.to,
              partial: b.partial,
              slices,
              timezone: c.venue.timezone,
            },
            startsAt: first.startsAt,
            endsAt: last.endsAt,
            contractRevisionId: first.contractRevisionId,
            policyRevisionId: first.policyRevisionId,
            idempotencyKey: b.idempotencyKey,
            requestHash: hash(b),
          },
          now,
        );
      });
    },
    async requestShift(s: StaffIdentity, value: unknown) {
      const b = workforceShiftRequestSchema.parse(value);
      return mutate(s, async (tx) => {
        const retry = await requestRetry(tx, s, b.idempotencyKey, b);
        if (retry) return retry;
        const now = clock(),
          c = await context(tx, s),
          rows = await publishedAssignments(tx, s),
          row = rows.find((r) => r.after.id === b.assignmentId);
        if (
          !row ||
          row.publishedAssignmentRevisionId !== b.publicationRevisionId
        )
          throw new WorkforceError(
            "CONFLICT",
            "Published shift changed. Reload before requesting.",
          );
        if (Date.parse(row.after.startsAt) <= now.getTime())
          throw new WorkforceError(
            "PAST",
            "Only future published shifts can be requested.",
          );
        if (
          b.kind === "OPEN"
            ? row.after.userId !== null
            : row.after.userId !== s.userId
        )
          throw new WorkforceError(
            "APPROVAL",
            "Choose your own shift, or an available open shift.",
          );
        let invitedUserId: string | null = null,
          other: typeof row | undefined;
        if (b.kind === "OPEN") {
          if (
            b.targetMembershipId ||
            b.otherAssignmentId ||
            b.otherPublicationRevisionId
          )
            throw new WorkforceError(
              "INVALID",
              "Open claims have no invited coworker.",
            );
        } else {
          if (!b.targetMembershipId)
            throw new WorkforceError("INVALID", "Choose a coworker.");
          const target = await context(tx, s, b.targetMembershipId);
          if (
            !target.member.active ||
            !target.member.user.active ||
            target.member.userId === s.userId
          )
            throw new WorkforceError(
              "INVALID",
              "Choose another active coworker.",
            );
          invitedUserId = target.member.userId;
          if (b.kind === "SWAP") {
            other = rows.find((r) => r.after.id === b.otherAssignmentId);
            if (
              !other ||
              other.after.userId !== invitedUserId ||
              other.publishedAssignmentRevisionId !==
                b.otherPublicationRevisionId ||
              Date.parse(other.after.startsAt) <= now.getTime()
            )
              throw new WorkforceError(
                "CONFLICT",
                "Coworker shift changed or is unavailable.",
              );
          } else if (b.otherAssignmentId || b.otherPublicationRevisionId)
            throw new WorkforceError(
              "INVALID",
              "An offer transfers one shift only.",
            );
        }
        const contract = workforceContractAt(
            c.profile.contracts,
            row.after.startsLocal.slice(0, 10),
          ),
          p = await policy(
            tx,
            s,
            contract?.countryCode ?? c.venue.countryCode ?? "",
            row.after.startsLocal.slice(0, 10),
            now,
          );
        const scheduleIds = [
          ...new Set([row.scheduleId, ...(other ? [other.scheduleId] : [])]),
        ];
        const schedules = await tx.venueSchedule.findMany({
          where: { ...scope(s), id: { in: scheduleIds } },
        });
        if (
          schedules.some(
            (x) => x.status !== "PUBLISHED" || x.version !== x.publishedVersion,
          )
        )
          throw new WorkforceError(
            "CONFLICT",
            "Publish or reconcile outstanding drafts before requesting a shift change.",
          );
        return createRequest(
          tx,
          s,
          {
            kind: b.kind,
            profileId: c.profile.id,
            payload: {
              assignmentId: b.assignmentId,
              publicationRevisionId: b.publicationRevisionId,
              targetMembershipId: b.targetMembershipId,
              otherAssignmentId: b.otherAssignmentId,
              otherPublicationRevisionId: b.otherPublicationRevisionId,
              scheduleVersions: schedules.map((x) => ({
                id: x.id,
                version: x.version,
              })),
              policyManagerApproval: p.rules.managerShiftApproval,
            },
            startsAt: row.after.startsAt,
            endsAt: row.after.endsAt,
            contractRevisionId: contract?.id ?? null,
            policyRevisionId: p.id,
            invitedUserId,
            idempotencyKey: b.idempotencyKey,
            requestHash: hash(b),
          },
          now,
        );
      });
    },
    async decide(s: StaffIdentity, id: string, value: unknown) {
      const b = workforceRequestDecisionSchema.parse(value);
      return mutate(s, async (tx) => {
        const now = clock(),
          r = await tx.workforceRequest.findFirst({
            where: { ...scope(s), id },
            include: includeRequest,
          });
        if (!r) throw missing();
        if (r.version !== b.expectedVersion)
          throw new WorkforceError(
            "CONFLICT",
            "Another reviewer changed this request. Reload its history.",
          );
        if (b.action === "ACCEPT" || b.action === "DECLINE") {
          if (r.invitedUserId !== s.userId)
            throw new WorkforceError(
              "APPROVAL",
              "Only the invited coworker may answer this offer.",
            );
        } else if (b.action === "WITHDRAW") {
          if (
            r.userId !== s.userId &&
            !(
              r.kind === "CORRECTION" &&
              r.transitions[0]?.actorUserId === s.userId
            )
          )
            throw new WorkforceError(
              "APPROVAL",
              "Only the requester may withdraw a pending request.",
            );
        } else {
          assertStaffPermission(s.role, "SCHEDULE_MANAGE");
          assertIndependentWorkforceReview(s.userId, r.userId);
          if (r.invitedUserId === s.userId)
            throw new WorkforceError(
              "APPROVAL",
              "Another manager must approve a shift change involving you.",
            );
          if (!b.reviewConfirmed || b.reason.length < 3)
            throw new WorkforceError(
              "APPROVAL",
              "Review explicitly and enter an operational decision reason.",
            );
        }
        const status = workforceRequestTransition(
          r.status as WorkforceRequestStatus,
          b.action,
          r.kind,
        );
        let result: unknown = { schemaVersion: 1 };
        if (status === "APPROVED") {
          if (r.kind === "CORRECTION")
            assertIndependentWorkforceReview(
              s.userId,
              r.transitions[0]?.actorUserId ?? r.userId,
            );
          if (r.kind === "LEAVE") {
            const p = r.payload as { category: string; slices: LeaveSlice[] };
            if (
              (
                await overlapsAbsence(
                  tx,
                  s,
                  r.userId,
                  r.startsAt.toISOString(),
                  r.endsAt.toISOString(),
                  r.id,
                )
              ).length
            )
              throw new WorkforceError(
                "CONFLICT",
                "An approved absence already overlaps this request.",
              );
            const impact = (await publishedAssignments(tx, s)).filter(
              (x) =>
                x.after.userId === r.userId &&
                x.after.startsAt < r.endsAt.toISOString() &&
                r.startsAt.toISOString() < x.after.endsAt,
            );
            if (impact.length && !b.warningsAcknowledged)
              throw new WorkforceError(
                "APPROVAL",
                "Review affected published shifts and acknowledge the staffing impact.",
              );
            if (p.category === "ANNUAL")
              for (const year of new Set(p.slices.map((x) => x.year))) {
                const bal = await balance(tx, s, r.userId, year),
                  charge = p.slices
                    .filter((x) => x.year === year)
                    .reduce((n, x) => n + x.chargedMinutes, 0);
                assertWorkforceLeaveAllowance(
                  bal.configured,
                  bal.allowanceMinutes,
                  bal.usedMinutes,
                  charge,
                );
              }
          } else if (r.kind === "CORRECTION")
            result = await approveCorrection(
              tx,
              s,
              r,
              b.warningsAcknowledged,
              b.reason,
              now,
            );
          else
            result = await approveShiftRequest(
              tx,
              s,
              r,
              b.warningsAcknowledged,
              now,
            );
        }
        const reason =
          r.kind === "LEAVE" &&
          (r.payload as { category: string }).category === "SICKNESS"
            ? ["APPROVE", "REJECT", "CANCEL_APPROVED"].includes(b.action)
              ? "Operational absence decision"
              : ""
            : b.reason;
        await tx.workforceRequest.update({
          where: { id: r.id },
          data: { status, version: { increment: 1 } },
        });
        await tx.workforceRequestTransition.create({
          data: {
            ...scope(s),
            requestId: r.id,
            version: r.version + 1,
            fromStatus: r.status,
            toStatus: status,
            action: b.action,
            actorUserId: s.userId,
            reason,
            result: json(result),
            createdAt: now,
          },
        });
        if (
          (r.kind === "LEAVE" && ["APPROVED", "CANCELLED"].includes(status)) ||
          (r.kind === "CORRECTION" && status === "APPROVED")
        )
          await reconcileWorkforceClosedAccounts(
            tx,
            s,
            r.userId,
            now,
            "Approved absence source reconciliation",
          );
        await intent(
          tx,
          s,
          r.kind + "_" + status,
          r.id,
          [r.userId, ...(r.invitedUserId ? [r.invitedUserId] : [])],
          now,
        );
        return requestView(
          await tx.workforceRequest.findUniqueOrThrow({
            where: { id: r.id },
            include: includeRequest,
          }),
        );
      });
    },
    async approveAttendance(
      s: StaffIdentity,
      id: string,
      expectedVersion: number,
      reason: string,
      reviewConfirmed: boolean,
      warningsAcknowledged: boolean,
    ) {
      assertStaffPermission(s.role, "SCHEDULE_MANAGE");
      return mutate(s, async (tx) => {
        const now = clock(),
          a = await tx.workforceAttendance.findFirst({
            where: { ...scope(s), id },
            include: includeAttendance,
          });
        if (!a) throw missing();
        assertIndependentWorkforceReview(s.userId, a.userId);
        if (!reviewConfirmed || reason.trim().length < 3)
          throw new WorkforceError(
            "APPROVAL",
            "Review the original evidence and confirm approval with a reason.",
          );
        if (a.version !== expectedVersion || approved(a))
          throw new WorkforceError(
            "CONFLICT",
            "Attendance changed or is already approved.",
          );
        if (a.state !== "CLOSED")
          throw new WorkforceError(
            "APPROVAL",
            "Recover missing punches through a correction request before approval.",
          );
        const snapshot = latestSnapshot(a, now);
        if (!snapshot)
          throw new WorkforceError(
            "INVALID",
            "No reproducible work interval exists.",
          );
        const p = await tx.workforcePolicy.findFirstOrThrow({
            where: { ...scope(s), id: a.policyRevisionId },
          }),
          warnings = await attendanceWarnings(
            tx,
            s,
            a,
            snapshot,
            workforcePolicyRulesSchema.parse(p.rules),
          );
        if (
          (warnings.length ||
            !a.publishedAssignmentRevisionId ||
            !a.contractRevisionId) &&
          !warningsAcknowledged
        )
          throw new WorkforceError(
            "APPROVAL",
            "Acknowledge unscheduled work, missing contract or compliance warnings explicitly.",
          );
        await validateAttendanceOverlap(tx, s, a.userId, a.id, snapshot, now);
        return saveApproval(
          tx,
          s,
          a,
          snapshot,
          null,
          a.contractRevisionId,
          a.policyRevisionId,
          a.timezone,
          reason,
          now,
        );
      });
    },
    async grant(s: StaffIdentity, value: unknown) {
      assertStaffPermission(s.role, "WORKFORCE_PRIVATE_MANAGE");
      const b = workforceLeaveGrantSchema.parse(value);
      return mutate(s, async (tx) => {
        const old = await tx.workforceLeaveGrant.findFirst({
          where: {
            tenantId: s.tenantId,
            actorUserId: s.userId,
            idempotencyKey: b.idempotencyKey,
          },
        });
        if (old) {
          if (old.venueId !== s.venueId || old.requestHash !== hash(b))
            throw new WorkforceError(
              "CONFLICT",
              "Allowance retry key conflicts.",
            );
          return balance(tx, s, old.userId, old.year);
        }
        const now = clock(),
          c = await context(tx, s, b.membershipId),
          date = workforceToday(c.venue.timezone, now),
          contract = workforceContractAt(c.profile.contracts, date);
        if (!contract)
          throw new WorkforceError(
            "INVALID",
            "Record an effective contract before granting an allowance.",
          );
        const p = await policy(tx, s, contract.countryCode, date, now),
          bal = await balance(tx, s, c.member.userId, b.year);
        if (bal.version !== b.expectedVersion)
          throw new WorkforceError(
            "CONFLICT",
            "Allowance changed. Reload its history.",
          );
        assertWorkforceLeaveAllowance(
          true,
          (bal.allowanceMinutes ?? 0) + b.minutes,
          bal.usedMinutes,
          0,
        );
        await tx.workforceLeaveGrant.create({
          data: {
            ...scope(s),
            userId: c.member.userId,
            membershipId: c.member.id,
            profileId: c.profile.id,
            year: b.year,
            version: bal.version + 1,
            minutes: b.minutes,
            reason: b.reason,
            contractRevisionId: contract.id,
            policyRevisionId: p.id,
            actorUserId: s.userId,
            idempotencyKey: b.idempotencyKey,
            requestHash: hash(b),
            createdAt: now,
          },
        });
        await audit(tx, s, "LEAVE_ALLOWANCE_ADJUSTED", c.profile.id, now);
        return balance(tx, s, c.member.userId, b.year);
      });
    },
    async approvedHours(s: StaffIdentity, from: string, to: string) {
      assertStaffPermission(s.role, "SCHEDULE_VIEW");
      if (to < from || to > workforceAddDays(from, 92))
        throw new WorkforceError("TIME", "Select at most 93 calendar days.");
      return prisma.$transaction(
        async (tx) => {
          await actor(tx, s);
          const c = await context(tx, s);
          const start = workforceDayRange(from, c.venue.timezone).start;
          const end = workforceDayRange(to, c.venue.timezone).end;
          const canManage = hasStaffPermission(s.role, "SCHEDULE_MANAGE");
          // Canonical source, independent of the 200-row UI listing. Include moved
          // corrections and clip using each approval's frozen timezone below.
          const ids = await tx.$queryRaw<
            { id: string }[]
          >`SELECT a.id FROM "WorkforceAttendance" a JOIN "WorkforceAttendanceApproval" p ON p."attendanceId"=a.id AND p."attendanceVersion"=a.version WHERE a."tenantId"=${s.tenantId} AND a."venueId"=${s.venueId} AND (${canManage} OR a."userId"=${s.userId}) AND ((p.snapshot->>'startsAt')::timestamptz AT TIME ZONE 'UTC')<${new Date(end + 86400000)} AND ((p.snapshot->>'endsAt')::timestamptz AT TIME ZONE 'UTC')>${new Date(start - 86400000)} ORDER BY a.id`;
          const attendance: ReturnType<typeof attendanceView>[] = [];
          for (let offset = 0; offset < ids.length; offset += 500) {
            const rows = await tx.workforceAttendance.findMany({
              where: {
                ...scope(s),
                ...(!canManage ? { userId: s.userId } : {}),
                id: { in: ids.slice(offset, offset + 500).map((r) => r.id) },
              },
              include: includeAttendance,
            });
            for (const row of rows) {
              const view = attendanceView(row, clock());
              if (view.approved) {
                const stored = view.approved.snapshot as AttendanceSnapshot & {
                  timezone?: string;
                };
                const zone = stored.timezone ?? view.timezone;
                if (
                  Date.parse(stored.startsAt) <
                    workforceDayRange(to, zone).end &&
                  Date.parse(stored.endsAt) >
                    workforceDayRange(from, zone).start
                )
                  attendance.push(view);
              }
            }
          }
          const records = attendance
            .filter((a) => a.approved)
            .map((a) => {
              const approval = a.approved!,
                stored = approval.snapshot as AttendanceSnapshot & {
                  timezone?: string;
                  contractRevisionId?: string | null;
                  policyRevisionId?: string;
                };
              const result: WorkforceApprovedAttendanceV1 = {
                schemaVersion: 1,
                attendanceId: a.id,
                approvalId: approval.id,
                ...scope(s),
                userId: a.userId,
                membershipId: a.membershipId,
                timezone: stored.timezone ?? a.timezone,
                contractRevisionId:
                  stored.contractRevisionId === undefined
                    ? a.contractRevisionId
                    : stored.contractRevisionId,
                policyRevisionId: stored.policyRevisionId ?? a.policyRevisionId,
                sourceEventIds: approval.sourceEventIds,
                correctionRequestId: approval.correctionRequestId,
                snapshot: {
                  startsAt: stored.startsAt,
                  endsAt: stored.endsAt,
                  breaks: stored.breaks,
                },
                totals: approval.totals as ReturnType<
                  typeof workforceAttendanceTotals
                >,
                approvedByUserId: approval.actorUserId,
                approvedAt: approval.createdAt,
              };
              return result;
            });
          return {
            schemaVersion: 1,
            from,
            to,
            truncated: false,
            records,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 30000,
        },
      );
    },
    async exchangeOptions(
      s: StaffIdentity,
      assignmentId: string,
      targetMembershipId?: string,
    ) {
      assertStaffPermission(s.role, "SCHEDULE_VIEW");
      return prisma.$transaction(
        async (tx) => {
          await actor(tx, s);
          const rows = await publishedAssignments(tx, s);
          const first = rows.find(
            (r) =>
              r.after.id === assignmentId &&
              r.after.userId === s.userId &&
              Date.parse(r.after.startsAt) > clock().getTime(),
          );
          if (!first) throw missing();
          const members = await tx.membership.findMany({
            where: {
              ...scope(s),
              active: true,
              user: { active: true },
              userId: { not: s.userId },
            },
            select: {
              id: true,
              userId: true,
              user: { select: { displayName: true } },
            },
          });
          const roster = [];
          for (const member of members) {
            if (await shiftEligible(tx, s, first.after, member.id))
              roster.push({
                membershipId: member.id,
                displayName: member.user.displayName,
              });
          }
          if (
            targetMembershipId &&
            !roster.some((r) => r.membershipId === targetMembershipId)
          )
            throw missing();
          const shifts = [];
          if (targetMembershipId)
            for (const row of rows) {
              if (
                row.after.membershipId === targetMembershipId &&
                Date.parse(row.after.startsAt) > clock().getTime() &&
                Math.abs(
                  Date.parse(row.after.startsAt) -
                    Date.parse(first.after.startsAt),
                ) <=
                  93 * 86400000 &&
                (await shiftEligible(tx, s, row.after, s.membershipId))
              )
                shifts.push(shiftChoice(row));
            }
          return { assignmentId, roster, shifts };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 20000,
        },
      );
    },
    async leaveBalance(s: StaffIdentity, membershipId: string, year: number) {
      assertStaffPermission(s.role, "SCHEDULE_VIEW");
      return prisma.$transaction(async (tx) => {
        await actor(tx, s);
        const c = await context(tx, s, membershipId);
        if (s.role !== "OWNER" && c.member.userId !== s.userId)
          throw new StaffPermissionDeniedError(
            s.role,
            "WORKFORCE_PRIVATE_MANAGE",
          );
        return balance(tx, s, c.member.userId, year);
      });
    },
    async configure(s: StaffIdentity, value: unknown) {
      assertStaffPermission(s.role, "WORKFORCE_PRIVATE_MANAGE");
      const b = workforcePolicyWriteSchema.parse(value);
      return mutate(s, async (tx) => {
        const now = clock(),
          c = await context(tx, s),
          rows = await tx.workforcePolicy.findMany({
            where: { ...scope(s), countryCode: b.countryCode },
            orderBy: { version: "desc" },
          }),
          last = rows[0];
        if ((last?.version ?? 0) !== b.expectedVersion)
          throw new WorkforceError(
            "CONFLICT",
            "Workforce policy changed. Reload its versions.",
          );
        assertWorkforcePolicyDate(
          b.effectiveFrom,
          last ?? null,
          workforceToday(c.venue.timezone, now),
        );
        const row = await tx.workforcePolicy.create({
          data: {
            ...scope(s),
            version: (last?.version ?? 0) + 1,
            effectiveFrom: b.effectiveFrom,
            countryCode: b.countryCode,
            rules: json(b.rules),
            reason: b.reason,
            createdByUserId: s.userId,
            createdAt: now,
          },
        });
        await audit(tx, s, "WORKFORCE_POLICY_VERSION", row.id, now);
        return {
          id: row.id,
          version: row.version,
          effectiveFrom: row.effectiveFrom,
        };
      });
    },
    async workspace(s: StaffIdentity, from: string, to: string) {
      assertStaffPermission(s.role, "SCHEDULE_VIEW");
      if (to < from || to > workforceAddDays(from, 92))
        throw new WorkforceError("TIME", "Select at most 93 calendar days.");
      return prisma.$transaction(
        async (tx) => {
          await actor(tx, s);
          const now = clock(),
            c = await context(tx, s),
            canManage = hasStaffPermission(s.role, "SCHEDULE_MANAGE"),
            today = workforceToday(c.venue.timezone, now);
          const start = workforceDayRange(from, c.venue.timezone).start,
            end = workforceDayRange(to, c.venue.timezone).end;
          const corrected = await tx.$queryRaw<
            { attendanceId: string }[]
          >`SELECT DISTINCT e."attendanceId" FROM "WorkforceAttendanceEvent" e WHERE e."tenantId"=${s.tenantId} AND e."venueId"=${s.venueId} AND (${canManage} OR e."userId"=${s.userId}) AND e.kind='CORRECTION' AND ((e.payload->'snapshot'->>'startsAt')::timestamptz AT TIME ZONE 'UTC')<${new Date(end + 86400000)} AND ((e.payload->'snapshot'->>'endsAt')::timestamptz AT TIME ZONE 'UTC')>${new Date(start - 86400000)}`;
          const rows = await tx.workforceAttendance.findMany({
            where: {
              ...scope(s),
              ...(!canManage ? { userId: s.userId } : {}),
              OR: [
                {
                  startedAt: {
                    gte: new Date(start - 7 * 86400000),
                    lt: new Date(end + 86400000),
                  },
                },
                { state: { not: "CLOSED" } },
                { id: { in: corrected.map((r) => r.attendanceId) } },
              ],
            },
            include: includeAttendance,
            orderBy: { startedAt: "desc" },
            take: 200,
          });
          const attendance = rows
            .map((a) => attendanceView(a, now))
            .filter(
              (a) =>
                a.state !== "CLOSED" ||
                (a.actual &&
                  a.actual.startsAt <
                    new Date(
                      workforceDayRange(to, a.timezone).end,
                    ).toISOString() &&
                  a.actual.endsAt >
                    new Date(
                      workforceDayRange(from, a.timezone).start,
                    ).toISOString()),
            );
          const requests = await tx.workforceRequest.findMany({
            where: {
              ...scope(s),
              ...(!canManage
                ? { OR: [{ userId: s.userId }, { invitedUserId: s.userId }] }
                : {}),
              AND: [
                {
                  OR: [
                    { status: { in: ["PENDING", "ACCEPTED"] } },
                    {
                      startsAt: { lt: new Date(end) },
                      endsAt: { gt: new Date(start) },
                    },
                    {
                      transitions: {
                        some: {
                          createdAt: {
                            gte: new Date(now.getTime() - 30 * 86400000),
                          },
                        },
                      },
                    },
                  ],
                },
              ],
            },
            include: includeRequest,
            orderBy: { createdAt: "desc" },
            take: 200,
          });
          const members = await tx.membership.findMany({
            where: { ...scope(s), ...(!canManage ? { userId: s.userId } : {}) },
            select: {
              id: true,
              userId: true,
              active: true,
              role: true,
              user: { select: { displayName: true, active: true } },
            },
          });
          const publications = await publishedAssignments(tx, s),
            future = publications.filter(
              (r) =>
                r.after.startsAt < new Date(end).toISOString() &&
                r.after.endsAt > new Date(start).toISOString(),
            );
          const visibleShifts = [];
          const ownPublished = [];
          if (!canManage) {
            const venues = await tx.venue.findMany({
              where: { tenantId: s.tenantId },
              select: { id: true },
            });
            for (const venue of venues)
              ownPublished.push(
                ...(await publishedAssignments(tx, s, venue.id))
                  .filter((p) => p.after.userId === s.userId)
                  .map((p) => p.after),
              );
          }
          for (const row of future) {
            if (
              canManage ||
              row.after.userId === s.userId ||
              (row.after.userId === null &&
                Date.parse(row.after.startsAt) > now.getTime() &&
                (await shiftEligible(tx, s, row.after, s.membershipId)) &&
                !ownPublished.some(
                  (p) =>
                    p.startsAt < row.after.endsAt &&
                    row.after.startsAt < p.endsAt,
                ))
            )
              visibleShifts.push(row);
          }
          const policies = policyVersions(
            await tx.workforcePolicy.findMany({
              where: scope(s),
              orderBy: { version: "desc" },
            }),
          );
          const currentContract = workforceContractAt(
              c.profile.contracts,
              today,
            ),
            country = currentContract?.countryCode ?? c.venue.countryCode ?? "";
          const versions = policies.filter((p) => p.countryCode === country),
            current =
              versions
                .filter((p) => p.effectiveFrom <= today)
                .sort(
                  (a, b) =>
                    b.effectiveFrom.localeCompare(a.effectiveFrom) ||
                    b.version - a.version,
                )[0] ?? null;
          const activeElsewhere = await tx.workforceAttendance.findFirst({
            where: {
              tenantId: s.tenantId,
              userId: s.userId,
              venueId: { not: s.venueId },
              state: { not: "CLOSED" },
            },
            select: { id: true, venueId: true, state: true },
          });
          const warnings = await Promise.all(
            rows.map(async (a) => {
              const snapshot = latestSnapshot(a, now),
                p = policies.find((p) => p.id === a.policyRevisionId);
              return {
                attendanceId: a.id,
                codes: [
                  ...(!a.publishedAssignmentRevisionId ? ["UNSCHEDULED"] : []),
                  ...(!a.contractRevisionId ? ["CONTRACT_MISSING"] : []),
                  ...(a.state !== "CLOSED" &&
                  now.getTime() - a.startedAt.getTime() > 16 * 3600000
                    ? ["MISSING_OUT"]
                    : []),
                  ...(snapshot && p
                    ? await attendanceWarnings(tx, s, a, snapshot, p.rules)
                    : []),
                ],
              };
            }),
          );
          const activeUsers = new Set(
            rows.filter((a) => a.state !== "CLOSED").map((a) => a.userId),
          );
          const todayShifts = future.filter(
            (r) =>
              r.after.userId &&
              Date.parse(r.after.startsAt) <= now.getTime() &&
              Date.parse(r.after.endsAt) > now.getTime(),
          );
          const absent = canManage
            ? todayShifts
                .filter((r) => !activeUsers.has(r.after.userId!))
                .map((r) => ({
                  assignmentId: r.after.id,
                  userId: r.after.userId!,
                  membershipId: r.after.membershipId!,
                  startsAt: r.after.startsAt,
                  endsAt: r.after.endsAt,
                  status:
                    Date.parse(r.after.startsAt) < now.getTime() - 15 * 60000
                      ? "ABSENT"
                      : "LATE",
                }))
            : [];
          const operationalSession = await tx.staffShift.findFirst({
            where: { ...scope(s), userId: s.userId, status: "OPEN" },
            select: { id: true, startedAt: true },
          });
          const ownBalance = await balance(
            tx,
            s,
            s.userId,
            Number(today.slice(0, 4)),
          );
          const balances =
            s.role === "OWNER"
              ? await Promise.all(
                  members.map((m) =>
                    balance(tx, s, m.userId, Number(today.slice(0, 4))).then(
                      (b) => ({ ...b, membershipId: m.id, userId: m.userId }),
                    ),
                  ),
                )
              : [];
          return {
            operationalSession: operationalSession
              ? {
                  id: operationalSession.id,
                  startedAt: operationalSession.startedAt.toISOString(),
                }
              : null,
            serverNow: now.toISOString(),
            today,
            viewer: {
              userId: s.userId,
              membershipId: s.membershipId,
              role: s.role,
              canManage,
              canConfigure: s.role === "OWNER",
            },
            venue: {
              id: s.venueId,
              name: c.venue.name,
              timezone: c.venue.timezone,
              countryCode: country,
            },
            policy: current,
            policyVersions: policies,
            rules: current?.rules ?? workforceDefaultRules(country),
            attendance,
            current:
              attendance.find(
                (a) => a.userId === s.userId && a.state !== "CLOSED",
              ) ?? null,
            activeElsewhere,
            requests: requests.map((r) => ({
              ...requestView(r),
              allowedActions: workforceRequestActions(
                {
                  ...r,
                  createdByUserId: r.transitions[0]?.actorUserId ?? r.userId,
                },
                {
                  userId: s.userId,
                  canManage,
                },
              ),
              affectedShifts: publications
                .filter((x) =>
                  r.kind === "LEAVE"
                    ? x.after.userId === r.userId &&
                      x.after.startsAt < r.endsAt.toISOString() &&
                      r.startsAt.toISOString() < x.after.endsAt
                    : [
                        (r.payload as { assignmentId?: string }).assignmentId,
                        (r.payload as { otherAssignmentId?: string })
                          .otherAssignmentId,
                      ].includes(x.after.id),
                )
                .map((x) => ({
                  assignmentId: x.after.id,
                  userId: x.after.userId,
                  startsLocal: x.after.startsLocal,
                  endsLocal: x.after.endsLocal,
                  station: x.after.station,
                })),
            })),
            roster: members.map((m) => ({
              membershipId: m.id,
              userId: m.userId,
              displayName: m.user.displayName,
              role: m.role,
              active: m.active && m.user.active,
            })),
            shifts: visibleShifts.map(shiftChoice),
            nextShift:
              publications.find(
                (r) =>
                  r.after.userId === s.userId &&
                  r.after.endsAt > now.toISOString(),
              )?.after ?? null,
            balance: ownBalance,
            balances,
            warnings,
            absent,
            truncated: rows.length === 200 || requests.length === 200,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 20000,
        },
      );
    },
  };
}
function latestSnapshot(a: Attendance, now: Date) {
  const events = evidence(a);
  return (
    [...events].reverse().find((e) => e.kind === "CORRECTION")?.payload
      .snapshot ?? workforceOriginalAttendance(events, now.toISOString())
  );
}
async function attendanceWarnings(
  tx: Tx,
  s: StaffIdentity,
  a: Attendance,
  snapshot: AttendanceSnapshot,
  rules: WorkforcePolicyVersion["rules"],
) {
  const previous = await tx.workforceAttendance.findMany({
    where: {
      tenantId: s.tenantId,
      userId: a.userId,
      id: { not: a.id },
      startedAt: { lt: new Date(snapshot.startsAt) },
      state: "CLOSED",
    },
    include: includeAttendance,
    orderBy: { startedAt: "desc" },
    take: 10,
  });
  const previousEnd = previous
    .map((p) => latestSnapshot(p, new Date(snapshot.startsAt))?.endsAt)
    .filter((v): v is string => !!v && v <= snapshot.startsAt)
    .sort()
    .at(-1);
  return workforceAttendanceWarnings(snapshot, rules, previousEnd);
}
async function validateAttendanceOverlap(
  tx: Tx,
  s: StaffIdentity,
  userId: string,
  id: string,
  snapshot: AttendanceSnapshot,
  now: Date,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
 SELECT a.id FROM "WorkforceAttendance" a
 LEFT JOIN LATERAL (SELECT e.payload FROM "WorkforceAttendanceEvent" e WHERE e."attendanceId"=a.id AND e.kind='CORRECTION' ORDER BY e.sequence DESC LIMIT 1) c ON true
 LEFT JOIN LATERAL (SELECT e."occurredAt" FROM "WorkforceAttendanceEvent" e WHERE e."attendanceId"=a.id AND e.kind='CLOCK_OUT' ORDER BY e.sequence DESC LIMIT 1) o ON true
 WHERE a."tenantId"=${s.tenantId} AND a."userId"=${userId} AND a.id<>${id}
 AND COALESCE(((c.payload->'snapshot'->>'startsAt')::timestamptz AT TIME ZONE 'UTC'),a."startedAt")<${new Date(snapshot.endsAt)}
 AND COALESCE(((c.payload->'snapshot'->>'endsAt')::timestamptz AT TIME ZONE 'UTC'),o."occurredAt",${now})>${new Date(snapshot.startsAt)} LIMIT 1`;
  if (rows.length)
    throw new WorkforceError(
      "CONFLICT",
      "Approved work cannot overlap another attendance session or venue.",
      "OVERLAP",
    );
}
async function saveApproval(
  tx: Tx,
  s: StaffIdentity,
  a: Attendance,
  snapshot: AttendanceSnapshot,
  requestId: string | null,
  contractRevisionId: string | null,
  policyRevisionId: string,
  timezone: string,
  reason: string,
  now: Date,
) {
  const approval = await tx.workforceAttendanceApproval.create({
    data: {
      ...scope(s),
      attendanceId: a.id,
      attendanceVersion: a.version,
      userId: a.userId,
      actorUserId: s.userId,
      reason,
      snapshot: json({
        ...snapshot,
        schemaVersion: 1,
        contractRevisionId,
        policyRevisionId,
        timezone,
      }),
      calculation: json(workforceAttendanceTotals(snapshot)),
      sourceEventIds: a.events.map((e) => e.id),
      correctionRequestId: requestId,
      createdAt: now,
    },
  });
  if (!requestId)
    await reconcileWorkforceClosedAccounts(
      tx,
      s,
      a.userId,
      now,
      "Approved attendance source reconciliation",
    );
  await intent(tx, s, "ATTENDANCE_APPROVED", a.id, [a.userId], now);
  return {
    attendanceId: a.id,
    approvalId: approval.id,
    attendanceVersion: a.version,
    sourceEventIds: approval.sourceEventIds,
    snapshot,
    totals: workforceAttendanceTotals(snapshot),
    contractRevisionId,
    policyRevisionId,
    timezone,
  };
}
async function approveCorrection(
  tx: Tx,
  s: StaffIdentity,
  r: Request,
  warningsAcknowledged: boolean,
  reason: string,
  now: Date,
) {
  const p = r.payload as {
    snapshot: AttendanceSnapshot;
    attendanceId: string | null;
    attendanceVersion: number;
    timezone: string;
  };
  let a = p.attendanceId
    ? await tx.workforceAttendance.findFirst({
        where: { ...scope(s), id: p.attendanceId, userId: r.userId },
        include: includeAttendance,
      })
    : null;
  if (p.attendanceId && !a) throw missing();
  if ((a?.version ?? 0) !== p.attendanceVersion)
    throw new WorkforceError(
      "CONFLICT",
      "Original attendance changed after this correction was requested.",
    );
  if (Date.parse(p.snapshot.endsAt) > now.getTime())
    throw new WorkforceError("TIME", "Future work cannot be approved.");
  const policyRow = await tx.workforcePolicy.findFirstOrThrow({
    where: { ...scope(s), id: r.policyRevisionId },
  });
  const warnings = workforceAttendanceWarnings(
    p.snapshot,
    workforcePolicyRulesSchema.parse(policyRow.rules),
  );
  if (
    (warnings.length ||
      !a?.publishedAssignmentRevisionId ||
      !r.contractRevisionId) &&
    !warningsAcknowledged
  )
    throw new WorkforceError(
      "APPROVAL",
      "Acknowledge work exceptions and compliance warnings explicitly.",
    );
  await validateAttendanceOverlap(
    tx,
    s,
    r.userId,
    a?.id ?? "missing",
    p.snapshot,
    now,
  );
  if (!a) {
    if (
      await tx.workforceAttendance.findFirst({
        where: {
          tenantId: s.tenantId,
          userId: r.userId,
          state: { not: "CLOSED" },
        },
      })
    )
      throw new WorkforceError(
        "CONFLICT",
        "Recover the active attendance first.",
      );
    a = await tx.workforceAttendance.create({
      data: {
        ...scope(s),
        userId: r.userId,
        membershipId: r.membershipId,
        profileId: r.profileId,
        timezone: p.timezone,
        contractRevisionId: r.contractRevisionId,
        policyRevisionId: r.policyRevisionId,
        state: "CLOSED",
        version: 1,
        startedAt: new Date(p.snapshot.startsAt),
        recordedAt: now,
      },
      include: includeAttendance,
    });
  } else
    a = await tx.workforceAttendance.update({
      where: { id: a.id },
      data: { state: "CLOSED", version: { increment: 1 } },
      include: includeAttendance,
    });
  await tx.workforceAttendanceEvent.create({
    data: {
      ...scope(s),
      userId: r.userId,
      attendanceId: a.id,
      sequence: a.version,
      kind: "CORRECTION",
      occurredAt: now,
      recordedAt: now,
      actorUserId: s.userId,
      idempotencyKey: "correction:" + r.id,
      requestHash: hash(p),
      payload: json({
        snapshot: p.snapshot,
        requestId: r.id,
        originalEventIds: a.events.map((e) => e.id),
      }),
      correctionRequestId: r.id,
    },
  });
  const updated = await tx.workforceAttendance.findUniqueOrThrow({
    where: { id: a.id },
    include: includeAttendance,
  });
  return saveApproval(
    tx,
    s,
    updated,
    p.snapshot,
    r.id,
    r.contractRevisionId,
    r.policyRevisionId,
    p.timezone,
    reason,
    now,
  );
}
async function approveShiftRequest(
  tx: Tx,
  s: StaffIdentity,
  r: Request,
  warningsAcknowledged: boolean,
  now: Date,
) {
  const p = r.payload as {
    assignmentId: string;
    publicationRevisionId: string;
    targetMembershipId: string | null;
    otherAssignmentId: string | null;
    otherPublicationRevisionId: string | null;
    scheduleVersions: { id: string; version: number }[];
  };
  const rows = await publishedAssignments(tx, s),
    first = rows.find((x) => x.after.id === p.assignmentId),
    second = p.otherAssignmentId
      ? rows.find((x) => x.after.id === p.otherAssignmentId)
      : null;
  if (
    !first ||
    first.publishedAssignmentRevisionId !== p.publicationRevisionId ||
    (p.otherAssignmentId &&
      (!second ||
        second.publishedAssignmentRevisionId !== p.otherPublicationRevisionId))
  )
    throw new WorkforceError(
      "CONFLICT",
      "Published assignment revision changed. Create a new reviewed request.",
    );
  if (
    Date.parse(first.after.startsAt) <= now.getTime() ||
    (second && Date.parse(second.after.startsAt) <= now.getTime())
  )
    throw new WorkforceError(
      "PAST",
      "Past or started shifts cannot be exchanged.",
    );
  if (
    r.kind === "OPEN"
      ? first.after.userId !== null
      : first.after.userId !== r.userId
  )
    throw new WorkforceError("CONFLICT", "Shift ownership changed.");
  if (second && second.after.userId !== r.invitedUserId)
    throw new WorkforceError("CONFLICT", "Coworker shift ownership changed.");
  const replacements = new Map<string, string>();
  replacements.set(
    first.after.id,
    r.kind === "OPEN" ? r.membershipId : p.targetMembershipId!,
  );
  if (second) replacements.set(second.after.id, r.membershipId);
  const changed: WorkforceInstantAssignment[] = [];
  for (const row of [first, ...(second ? [second] : [])]) {
    const c = await context(tx, s, replacements.get(row.after.id)!);
    const day = row.after.startsLocal.slice(0, 10);
    if (
      !c.member.active ||
      !c.member.user.active ||
      c.profile.employmentStatus === "ENDED" ||
      (c.profile.employmentStartedOn && day < c.profile.employmentStartedOn) ||
      (c.profile.employmentEndedOn && day > c.profile.employmentEndedOn)
    )
      throw new WorkforceError(
        "CONFLICT",
        "Worker is not available for this future assignment.",
      );
    const assignment = {
      ...row.after,
      membershipId: c.member.id,
      userId: c.member.userId,
      role: c.member.role,
      displayName: c.member.user.displayName,
    };
    const leave = await overlapsAbsence(
      tx,
      s,
      c.member.userId,
      assignment.startsAt,
      assignment.endsAt,
    );
    const notes = await tx.staffAvailabilityNote.findMany({
      where: {
        tenantId: s.tenantId,
        membership: { userId: c.member.userId },
        startsAt: { lt: new Date(assignment.endsAt) },
        endsAt: { gt: new Date(assignment.startsAt) },
      },
      select: { startsAt: true, endsAt: true },
    });
    assertWorkforceShiftEligibility(
      assignment,
      {
        membershipId: c.member.id,
        stations: c.profile.stations,
        skills: c.profile.skills,
        recurringAvailability: workforceAvailabilitySchema.parse(
          c.profile.recurringAvailability,
        ),
      },
      [...leave, ...notes].map((l) => ({
        membershipId: c.member.id,
        startsAt: l.startsAt.toISOString(),
        endsAt: l.endsAt.toISOString(),
      })),
    );
    changed.push(assignment);
  }
  const allVenueIds = (
      await tx.venue.findMany({
        where: { tenantId: s.tenantId },
        select: { id: true },
      })
    ).map((v) => v.id),
    all: WorkforceInstantAssignment[] = [];
  for (const id of allVenueIds)
    all.push(...(await publishedAssignments(tx, s, id)).map((x) => x.after));
  const affectedUsers = new Set(changed.map((a) => a.userId));
  const combined = all
    .filter((a) => !replacements.has(a.id) && affectedUsers.has(a.userId))
    .concat(changed);
  const policyRow = await tx.workforcePolicy.findFirstOrThrow({
      where: { ...scope(s), id: r.policyRevisionId },
    }),
    rules = workforcePolicyRulesSchema.parse(policyRow.rules),
    warnings = workforceShiftRestWarnings(combined, rules.minimumRestMinutes);
  if (warnings.length && !warningsAcknowledged)
    throw new WorkforceError(
      "APPROVAL",
      "Acknowledge the applicable rest-period warning explicitly.",
    );
  const scheduleIds = [
      ...new Set([first.scheduleId, ...(second ? [second.scheduleId] : [])]),
    ],
    versions: { scheduleId: string; version: number }[] = [];
  for (const id of scheduleIds) {
    const schedule = await tx.venueSchedule.findFirst({
        where: { ...scope(s), id },
      }),
      expected = p.scheduleVersions.find((v) => v.id === id);
    if (
      !schedule ||
      !expected ||
      schedule.version !== expected.version ||
      schedule.publishedVersion !== schedule.version ||
      schedule.status !== "PUBLISHED"
    )
      throw new WorkforceError(
        "CONFLICT",
        "Schedule has new revisions or unpublished changes. Reconcile it before approval.",
      );
    const week = workforceWeek(
      schedule.weekStartsOn.toISOString().slice(0, 10),
    );
    const assignments = rows
      .filter((x) => x.scheduleId === id)
      .map((x) => {
        const a = x.after;
        return {
          id: a.id,
          membershipId: replacements.get(a.id) ?? a.membershipId,
          station: a.station,
          startsLocal: a.startsLocal,
          endsLocal: a.endsLocal,
          startChoice: a.startChoice,
          endChoice: a.endChoice,
          breakMinutes: a.breakMinutes,
          requiredSkills: a.requiredSkills,
          note: a.note,
        };
      });
    const saved = await saveScheduleInTransaction(
      tx,
      s,
      {
        week,
        expectedVersion: schedule.version,
        status: "PUBLISHED",
        reviewConfirmed: true,
        assignments,
      },
      [],
      now,
    );
    versions.push({ scheduleId: id, version: saved.version });
  }
  return {
    schemaVersion: 1,
    changedAssignmentIds: [...replacements.keys()],
    scheduleVersions: versions,
    warnings,
  };
}
export const workforceOperationsRepository =
  createWorkforceOperationsRepository();

function shiftChoice(
  r: Awaited<ReturnType<typeof publishedAssignments>>[number],
) {
  return {
    assignmentId: r.after.id,
    publicationRevisionId: r.publishedAssignmentRevisionId,
    membershipId: r.after.membershipId,
    userId: r.after.userId,
    station: r.after.station,
    startsAt: r.after.startsAt,
    endsAt: r.after.endsAt,
    startsLocal: r.after.startsLocal,
    endsLocal: r.after.endsLocal,
    breakMinutes: r.after.breakMinutes,
  };
}
async function shiftEligible(
  tx: Tx,
  s: StaffIdentity,
  assignment: WorkforceInstantAssignment,
  membershipId: string,
) {
  try {
    const c = await context(tx, s, membershipId),
      day = assignment.startsLocal.slice(0, 10);
    if (
      !c.member.active ||
      !c.member.user.active ||
      c.profile.employmentStatus === "ENDED" ||
      (c.profile.employmentStartedOn && day < c.profile.employmentStartedOn) ||
      (c.profile.employmentEndedOn && day > c.profile.employmentEndedOn)
    )
      return false;
    const leaves = await overlapsAbsence(
      tx,
      s,
      c.member.userId,
      assignment.startsAt,
      assignment.endsAt,
    );
    const notes = await tx.staffAvailabilityNote.findMany({
      where: {
        tenantId: s.tenantId,
        membership: { userId: c.member.userId },
        startsAt: { lt: new Date(assignment.endsAt) },
        endsAt: { gt: new Date(assignment.startsAt) },
      },
      select: { startsAt: true, endsAt: true },
    });
    assertWorkforceShiftEligibility(
      { ...assignment, membershipId: c.member.id, userId: c.member.userId },
      {
        membershipId: c.member.id,
        stations: c.profile.stations,
        skills: c.profile.skills,
        recurringAvailability: workforceAvailabilitySchema.parse(
          c.profile.recurringAvailability,
        ),
      },
      [...leaves, ...notes].map((l) => ({
        membershipId: c.member.id,
        startsAt: l.startsAt.toISOString(),
        endsAt: l.endsAt.toISOString(),
      })),
    );
    return true;
  } catch (e) {
    if (
      e instanceof WorkforceError &&
      ["CONFLICT", "NOT_FOUND"].includes(e.code)
    )
      return false;
    throw e;
  }
}

export {
  actor as requireWorkforceActor,
  lock as lockWorkforceTenant,
  attendanceView as workforceAttendanceProjection,
  includeAttendance as workforceAttendanceInclude,
};
