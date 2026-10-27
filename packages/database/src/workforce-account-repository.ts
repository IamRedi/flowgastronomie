import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  assertStaffPermission,
  hasStaffPermission,
  StaffPermissionDeniedError,
  WorkforceError,
  workforceMonthlyAccount,
  workforceAccountPreviousMonth,
  workforceAccountRetentionUntil,
  workforceAccountPolicyWriteSchema,
  workforceAccountRulesSchema,
  workforcePolicyRulesSchema,
  workforceContractAt as effectiveVersion,
  workforceAccountPolicyAt,
  workforceCarryMilliseconds,
  assertWorkforceMonthlyClose,
  workforceMonthlyCloseEligible,
  assertIndependentWorkforceReview,
  workforceContractAt,
  workforceMonthRange,
  workforceMonthSchema,
  workforceToday,
  type WorkforceMonthlyInput,
  type WorkforceMonthlyAccount,
  type WorkforceAccountPolicy,
  type AttendanceSnapshot,
  type LeaveSlice,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import {
  requireWorkforceActor,
  lockWorkforceTenant,
  appendWorkforceAudit,
} from "./workforce-transaction.js";
import { publishedAssignments } from "./workforce-repository.js";
import {
  workforceAttendanceProjection,
  workforceAttendanceInclude,
  workforceAttendanceIdsInWindow,
} from "./workforce-attendance-projection.js";
import { enqueueWorkforceNotice } from "./workforce-notification-repository.js";
import type { StaffIdentity } from "./staff-auth-repository.js";
type Tx = Prisma.TransactionClient;
const scope = (s: StaffIdentity) => ({
  tenantId: s.tenantId,
  venueId: s.venueId,
});
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([k, x]) => JSON.stringify(k) + ":" + canonical(x))
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
export const workforceAccountHash = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
const missing = () =>
  new WorkforceError(
    "NOT_FOUND",
    "Employee or statement was not found in this venue.",
  );
async function target(
  tx: Tx,
  s: StaffIdentity,
  membershipId: string,
  authorize = true,
) {
  if (
    authorize &&
    membershipId !== s.membershipId &&
    !hasStaffPermission(s.role, "SCHEDULE_MANAGE")
  )
    throw new StaffPermissionDeniedError(s.role, "SCHEDULE_MANAGE");
  const member = await tx.membership.findFirst({
    where: { ...scope(s), id: membershipId },
    select: {
      id: true,
      userId: true,
      active: true,
      user: { select: { displayName: true, active: true } },
      staffProfile: {
        select: {
          id: true,
          version: true,
          employeeRef: true,
          employmentStartedOn: true,
          employmentEndedOn: true,
          employmentStatus: true,
          contracts: {
            orderBy: { version: "asc" },
            select: {
              id: true,
              version: true,
              effectiveFrom: true,
              countryCode: true,
              weeklyTargetMinutes: true,
              monthlyTargetMinutes: true,
              createdByUserId: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });
  const venue = await tx.venue.findFirst({
    where: { tenantId: s.tenantId, id: s.venueId },
    select: { timezone: true, name: true, countryCode: true },
  });
  if (!member?.staffProfile || !venue) throw missing();
  return { member, profile: member.staffProfile, venue };
}
function policies(
  rows: Prisma.WorkforceAccountPolicyGetPayload<object>[],
): WorkforceAccountPolicy[] {
  return rows.map((p) => ({
    id: p.id,
    version: p.version,
    effectiveFrom: p.effectiveFrom,
    countryCode: p.countryCode,
    rules: workforceAccountRulesSchema.parse(p.rules),
    createdByUserId: p.createdByUserId,
    createdAt: p.createdAt.toISOString(),
  }));
}
type FrozenContext = Pick<
  WorkforceMonthlyInput,
  | "timezone"
  | "contracts"
  | "policies"
  | "employmentStartedOn"
  | "employmentEndedOn"
> & {
  targetDays: WorkforceMonthlyAccount["targetDays"];
  carryRule: WorkforceAccountPolicy | null;
  identity?: {
    displayName: string;
    employeeRef: string | null;
    venueName: string;
  };
};
async function sourceInput(
  tx: Tx,
  s: StaffIdentity,
  membershipId: string,
  month: string,
  now: Date,
  frozen?: FrozenContext,
): Promise<WorkforceMonthlyInput> {
  const c = await target(tx, s, membershipId, false),
    contracts =
      frozen?.contracts ??
      c.profile.contracts.map((x) => ({
        ...x,
        createdAt: x.createdAt.toISOString(),
      }));
  const policyRows =
    frozen?.policies ??
    policies(
      await tx.workforceAccountPolicy.findMany({
        where: scope(s),
        orderBy: [{ effectiveFrom: "asc" }, { version: "asc" }],
      }),
    );
  const firstDay = month + "-01",
    contract = workforceContractAt(contracts, firstDay) ?? contracts[0] ?? null;
  const reportingPolicy = contract
    ? workforceAccountPolicyAt(policyRows, firstDay, contract.countryCode)
    : null;
  const timezone =
      frozen?.timezone ?? reportingPolicy?.rules.timezone ?? c.venue.timezone,
    range = workforceMonthRange(month, timezone);
  // Complete effective intervals, not original start-date heuristics or the UI's
  // 200 rows. This also discovers moved corrections and long missing clock-outs.
  const ids = await workforceAttendanceIdsInWindow(
    tx,
    { ...scope(s), userId: c.member.userId },
    range,
    now,
  );
  const attendance: WorkforceMonthlyInput["attendance"] = [];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const rows = await tx.workforceAttendance.findMany({
      where: {
        ...scope(s),
        userId: c.member.userId,
        id: { in: ids.slice(offset, offset + 500).map((r) => r.id) },
      },
      include: workforceAttendanceInclude,
      orderBy: { id: "asc" },
    });
    for (const row of rows) {
      const p = workforceAttendanceProjection(row, now),
        approved = row.approvals.find(
          (a) => a.attendanceVersion === row.version,
        ),
        stored = approved?.snapshot as
          | (AttendanceSnapshot & {
              contractRevisionId?: string | null;
              policyRevisionId?: string;
            })
          | undefined;
      attendance.push({
        id: row.id,
        state: row.state,
        version: row.version,
        timezone: row.timezone,
        contractRevisionId: row.contractRevisionId,
        policyRevisionId: row.policyRevisionId,
        sourceEventIds: row.events.map((e) => e.id),
        snapshot: p.actual,
        recordedAt: row.recordedAt.toISOString(),
        actorUserId: row.events[0]?.actorUserId ?? row.userId,
        publishedAssignmentRevisionId: row.publishedAssignmentRevisionId,
        approval:
          approved && stored
            ? {
                id: approved.id,
                snapshot: {
                  startsAt: stored.startsAt,
                  endsAt: stored.endsAt,
                  breaks: stored.breaks,
                },
                sourceEventIds: approved.sourceEventIds,
                actorUserId: approved.actorUserId,
                createdAt: approved.createdAt.toISOString(),
                contractRevisionId:
                  stored.contractRevisionId === undefined
                    ? row.contractRevisionId
                    : stored.contractRevisionId,
                policyRevisionId:
                  stored.policyRevisionId ?? row.policyRevisionId,
              }
            : null,
      });
    }
  }
  const attendancePublicationIds = attendance.flatMap((a) =>
    a.publishedAssignmentRevisionId ? [a.publishedAssignmentRevisionId] : [],
  );
  const attendancePublications = await tx.publishedAssignmentRevision.findMany({
    where: { ...scope(s), id: { in: attendancePublicationIds } },
    select: { id: true, revisionId: true, after: true },
  });
  for (const a of attendance) {
    const publication = attendancePublications.find(
      (p) => p.id === a.publishedAssignmentRevisionId,
    );
    if (publication) {
      a.scheduleRevisionId = publication.revisionId;
      const after = publication.after as { station?: string } | null;
      if (after?.station) a.station = after.station;
    }
  }
  const requests = await tx.workforceRequest.findMany({
    where: {
      ...scope(s),
      userId: c.member.userId,
      startsAt: { lt: new Date(range.end) },
      endsAt: { gt: new Date(range.start) },
    },
    include: { transitions: { orderBy: { version: "desc" }, take: 1 } },
    orderBy: { id: "asc" },
  });
  const leave: WorkforceMonthlyInput["leave"] = requests
    .filter((r) => r.kind === "LEAVE")
    .map((r) => {
      const p = r.payload as { category: string; slices: LeaveSlice[] },
        decision = r.transitions[0];
      return {
        id: r.id,
        category: p.category,
        status: r.status,
        slices: p.slices,
        decisionId: decision?.id ?? r.id,
        actorUserId: decision?.actorUserId ?? r.userId,
        occurredAt:
          decision?.createdAt.toISOString() ?? r.createdAt.toISOString(),
      };
    });
  const publications = (await publishedAssignments(tx, s)).filter(
    (p) =>
      p.after.userId === c.member.userId &&
      Date.parse(p.after.startsAt) < range.end &&
      Date.parse(p.after.endsAt) > range.start,
  );
  const revisionIds = [...new Set(publications.map((p) => p.revisionId))],
    revisions = await tx.scheduleRevision.findMany({
      where: { ...scope(s), id: { in: revisionIds } },
      select: { id: true, createdByUserId: true, createdAt: true },
    });
  const planned = publications.map((p) => {
    const r = revisions.find((r) => r.id === p.revisionId)!;
    return {
      id: p.publishedAssignmentRevisionId,
      scheduleRevisionId: p.revisionId,
      assignment: p.after,
      actorUserId: r.createdByUserId,
      createdAt: r.createdAt.toISOString(),
    };
  });
  return {
    month,
    timezone,
    contracts,
    policies: policyRows,
    employmentStartedOn:
      frozen?.employmentStartedOn ?? c.profile.employmentStartedOn,
    employmentEndedOn: frozen
      ? frozen.employmentEndedOn
      : c.profile.employmentEndedOn,
    planned,
    attendance,
    leave,
    pendingRequestIds: requests
      .filter((r) => ["PENDING", "ACCEPTED"].includes(r.status))
      .map((r) => r.id),
    carryMs: 0,
    carrySourceIds: [],
    ...(frozen ? { frozenTargetDays: frozen.targetDays } : {}),
  };
}
function lastPolicy(
  input: WorkforceMonthlyInput,
): WorkforceAccountPolicy | null {
  const date = workforceMonthRange(input.month, input.timezone).to,
    contract = workforceContractAt(input.contracts, date);
  return contract
    ? workforceAccountPolicyAt(input.policies, date, contract.countryCode)
    : null;
}
function effectiveSnapshot(
  close: Prisma.WorkforceMonthlyCloseGetPayload<object>,
  adjustments: Prisma.WorkforceMonthlyAdjustmentGetPayload<object>[],
) {
  return (adjustments[adjustments.length - 1]?.afterSnapshot ??
    close.snapshot) as unknown as WorkforceMonthlyAccount;
}
async function carry(
  tx: Tx,
  s: StaffIdentity,
  userId: string,
  input: WorkforceMonthlyInput,
  rule = lastPolicy(input),
) {
  if (!rule) return { milliseconds: null, sources: [] as string[] };
  if (rule.rules.carryoverMode === "NONE")
    return { milliseconds: 0, sources: [] as string[] };
  const prevMonth = workforceAccountPreviousMonth(input.month),
    previous = await tx.workforceMonthlyClose.findFirst({
      where: { ...scope(s), userId, month: prevMonth },
    });
  if (previous) {
    const adjustments = await tx.workforceMonthlyAdjustment.findMany({
        where: { ...scope(s), closeId: previous.id, userId },
        orderBy: { version: "asc" },
      }),
      a = effectiveSnapshot(previous, adjustments);
    return {
      milliseconds:
        a.totals.balanceMs === null
          ? null
          : workforceCarryMilliseconds(a.totals.balanceMs, rule.rules),
      sources: [previous.id, ...adjustments.map((x) => x.id)],
    };
  }
  return rule.rules.openingMonth === input.month
    ? {
        milliseconds: rule.rules.openingBalanceMinutes * 60000,
        sources: [rule.id],
      }
    : { milliseconds: null, sources: [] as string[] };
}
async function openAccount(
  tx: Tx,
  s: StaffIdentity,
  membershipId: string,
  month: string,
  now: Date,
) {
  const c = await target(tx, s, membershipId, false),
    input = await sourceInput(tx, s, membershipId, month, now),
    carryValue = await carry(tx, s, c.member.userId, input);
  input.carryMs = carryValue.milliseconds;
  input.carrySourceIds = carryValue.sources;
  const account = workforceMonthlyAccount(input);
  if (
    input.policies.some(
      (p) =>
        account.accountPolicyIds.includes(p.id) &&
        p.rules.timezone !== input.timezone,
    )
  )
    account.warnings.push("REPORT_TIMEZONE_CONFLICT");
  return {
    account,
    input,
    fingerprint: workforceAccountHash({
      profileVersion: c.profile.version,
      account,
      policyVersions: input.policies.filter((p) =>
        account.accountPolicyIds.includes(p.id),
      ),
    }),
  };
}
export async function reconcileWorkforceClosedAccounts(
  tx: Tx,
  s: StaffIdentity,
  userId: string,
  now: Date,
  reason: string,
) {
  const closes = await tx.workforceMonthlyClose.findMany({
    where: { ...scope(s), userId },
    orderBy: { month: "asc" },
  });
  for (const close of closes) {
    const frozen = close.frozenContext as unknown as FrozenContext,
      input = await sourceInput(
        tx,
        s,
        close.membershipId,
        close.month,
        now,
        frozen,
      ),
      cv = await carry(tx, s, userId, input, frozen.carryRule);
    input.carryMs = cv.milliseconds;
    input.carrySourceIds = cv.sources;
    const live = workforceMonthlyAccount(input),
      adjustments = await tx.workforceMonthlyAdjustment.findMany({
        where: { ...scope(s), closeId: close.id, userId },
        orderBy: { version: "asc" },
      }),
      old = effectiveSnapshot(close, adjustments),
      original = close.snapshot as unknown as WorkforceMonthlyAccount;
    // Close-time target/planning and country policy stay frozen. Only new actual/
    // approved/credited sources and linked carry propagation append compensation.
    live.totals.plannedMs = original.totals.plannedMs;
    live.totals.targetMs = original.totals.targetMs;
    live.entries = live.entries
      .filter((e) => !["TARGET", "PLANNED"].includes(e.category))
      .concat(
        original.entries.filter((e) =>
          ["TARGET", "PLANNED"].includes(e.category),
        ),
      )
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.category.localeCompare(b.category) ||
          a.sourceId.localeCompare(b.sourceId),
      );
    live.totals.balanceMs =
      original.totals.targetMs === null ||
      input.carryMs === null ||
      live.totals.creditedMs === null
        ? null
        : live.totals.approvedMs +
          live.totals.creditedMs -
          original.totals.targetMs +
          input.carryMs;
    const sourceHash = workforceAccountHash({
      totals: live.totals,
      entries: live.entries,
      carrySourceIds: live.carrySourceIds,
      absences: live.absences,
    });
    const oldHash = workforceAccountHash({
      totals: old.totals,
      entries: old.entries,
      carrySourceIds: old.carrySourceIds,
      absences: old.absences,
    });
    if (sourceHash === oldHash) continue;
    const delta = Object.fromEntries(
        Object.entries(live.totals).map(([k, v]) => [
          k,
          v === null || old.totals[k as keyof typeof old.totals] === null
            ? null
            : v - old.totals[k as keyof typeof old.totals]!,
        ]),
      ),
      id = randomUUID();
    const audit = await appendWorkforceAudit(
      tx,
      s,
      "WORKFORCE_MONTH_COMPENSATED",
      id,
      now,
      { schemaVersion: 1, closeId: close.id, sourceHash },
      "WORKFORCE_MONTHLY",
    );
    await tx.workforceMonthlyAdjustment.create({
      data: {
        id,
        ...scope(s),
        userId,
        closeId: close.id,
        version: adjustments.length + 1,
        sourceHash,
        delta: json(delta),
        afterSnapshot: json(live),
        sourceReferences: json({
          entries: live.entries.map((e) => ({
            sourceId: e.sourceId,
            sourceKind: e.sourceKind,
            approvalId: e.approvalId,
            leaveDecisionId: e.leaveDecisionId,
            contractRevisionId: e.contractRevisionId,
            policyRevisionId: e.policyRevisionId,
            accountPolicyRevisionId: e.accountPolicyRevisionId,
          })),
          carrySources: live.carrySourceIds,
        }),
        actorUserId: s.userId,
        reason,
        auditEventId: audit.id,
        createdAt: now,
      },
    });
    await enqueueWorkforceNotice(tx, {
      ...scope(s),
      userId,
      eventKey: "MONTH_ADJUSTED:" + id,
      sourceKind: "MONTHLY_ADJUSTMENT",
      subjectId: close.id,
      requiredPermission: "SELF",
      category: "MONTHLY_STATEMENT",
      link: { tab: "month", month: close.month },
      createdAt: now,
    });
  }
}
async function view(
  tx: Tx,
  s: StaffIdentity,
  membershipId: string,
  month: string,
  now: Date,
) {
  const c = await target(tx, s, membershipId),
    close = await tx.workforceMonthlyClose.findFirst({
      where: { ...scope(s), userId: c.member.userId, month },
    });
  let account: WorkforceMonthlyAccount,
    fingerprint: string,
    adjustments: Prisma.WorkforceMonthlyAdjustmentGetPayload<object>[] = [];
  if (close) {
    adjustments = await tx.workforceMonthlyAdjustment.findMany({
      where: { ...scope(s), closeId: close.id, userId: c.member.userId },
      orderBy: { version: "asc" },
    });
    account = effectiveSnapshot(close, adjustments);
    fingerprint = adjustments.at(-1)?.sourceHash ?? close.sourceHash;
  } else {
    const a = await openAccount(tx, s, membershipId, month, now);
    account = a.account;
    fingerprint = a.fingerprint;
  }
  return {
    schemaVersion: 1,
    tenantId: s.tenantId,
    venueId: s.venueId,
    venueName: c.venue.name,
    employee: {
      userId: c.member.userId,
      membershipId: c.member.id,
      profileId: c.profile.id,
      displayName: c.member.user.displayName,
      employeeRef: c.profile.employeeRef,
      active: c.member.active && c.member.user.active,
    },
    account,
    fingerprint,
    closing: close
      ? {
          id: close.id,
          version: close.version,
          closedAt: close.closedAt.toISOString(),
          actorUserId: close.actorUserId,
          reason: close.reason,
          retentionUntil: close.retentionUntil.toISOString(),
          auditEventId: close.auditEventId,
          sourceHash: close.sourceHash,
          identity: (close.frozenContext as unknown as FrozenContext)
            .identity ?? {
            displayName: c.member.user.displayName,
            employeeRef: c.profile.employeeRef,
            venueName: c.venue.name,
          },
          original: close.snapshot,
        }
      : null,
    adjustments: adjustments.map((a) => ({
      id: a.id,
      version: a.version,
      sourceHash: a.sourceHash,
      delta: a.delta,
      sourceReferences: a.sourceReferences,
      actorUserId: a.actorUserId,
      reason: a.reason,
      createdAt: a.createdAt.toISOString(),
      auditEventId: a.auditEventId,
    })),
    canClose:
      hasStaffPermission(s.role, "SCHEDULE_MANAGE") &&
      s.userId !== c.member.userId &&
      !close &&
      workforceMonthlyCloseEligible(account, now),
  };
}
export function createWorkforceAccountRepository(clock = () => new Date()) {
  return {
    async account(s: StaffIdentity, membershipId: string, month: string) {
      assertStaffPermission(s.role, "SCHEDULE_VIEW");
      workforceMonthSchema.parse(month);
      return prisma.$transaction(
        async (tx) => {
          await requireWorkforceActor(tx, s);
          return view(tx, s, membershipId, month, clock());
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 30000,
        },
      );
    },
    async configure(s: StaffIdentity, value: unknown) {
      assertStaffPermission(s.role, "WORKFORCE_PRIVATE_MANAGE");
      const b = workforceAccountPolicyWriteSchema.parse(value);
      return prisma.$transaction(async (tx) => {
        await lockWorkforceTenant(tx, s);
        await requireWorkforceActor(tx, s);
        const c = await target(tx, s, s.membershipId),
          old = await tx.workforceAccountPolicy.findFirst({
            where: { ...scope(s), countryCode: b.countryCode },
            orderBy: { version: "desc" },
          });
        if ((old?.version ?? 0) !== b.expectedVersion)
          throw new WorkforceError(
            "CONFLICT",
            "Account policy changed. Reload its versions.",
          );
        if (
          old &&
          (b.effectiveFrom < workforceToday(c.venue.timezone, clock()) ||
            b.effectiveFrom < old.effectiveFrom)
        )
          throw new WorkforceError(
            "PAST",
            "Later policy versions cannot rewrite historical account periods.",
          );
        const operational = await tx.workforcePolicy.findMany({
          where: { ...scope(s), countryCode: b.countryCode },
          orderBy: [{ effectiveFrom: "asc" }, { version: "asc" }],
        });
        for (const holiday of b.rules.holidays) {
          const applicable = effectiveVersion(operational, holiday.date);
          if (
            !applicable ||
            !workforcePolicyRulesSchema
              .parse(applicable.rules)
              .excludedLeaveDates.includes(holiday.date)
          )
            throw new WorkforceError(
              "CONFLICT",
              "Confirm this holiday in the canonical leave-policy calendar first, so annual leave is not debited on a credited holiday.",
              "HOLIDAY_CALENDAR",
            );
        }
        const row = await tx.workforceAccountPolicy.create({
          data: {
            ...scope(s),
            version: (old?.version ?? 0) + 1,
            countryCode: b.countryCode,
            effectiveFrom: b.effectiveFrom,
            rules: json(b.rules),
            reason: b.reason,
            createdByUserId: s.userId,
            createdAt: clock(),
          },
        });
        await appendWorkforceAudit(
          tx,
          s,
          "WORKFORCE_ACCOUNT_POLICY",
          row.id,
          clock(),
        );
        return {
          id: row.id,
          version: row.version,
          effectiveFrom: row.effectiveFrom,
        };
      });
    },
    async policyVersions(s: StaffIdentity) {
      assertStaffPermission(s.role, "SCHEDULE_VIEW");
      return prisma.$transaction(async (tx) => {
        await requireWorkforceActor(tx, s);
        return {
          canConfigure: s.role === "OWNER",
          versions: policies(
            await tx.workforceAccountPolicy.findMany({
              where: scope(s),
              orderBy: { version: "desc" },
            }),
          ).map((p) => ({
            ...p,
            createdByUserId: s.role === "OWNER" ? p.createdByUserId : null,
          })),
        };
      });
    },
    async close(
      s: StaffIdentity,
      membershipId: string,
      month: string,
      value: unknown,
    ) {
      assertStaffPermission(s.role, "SCHEDULE_MANAGE");
      workforceMonthSchema.parse(month);
      const b = z
        .object({
          idempotencyKey: z.string().min(8).max(128),
          expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          reason: z.string().trim().min(3).max(300),
          reviewConfirmed: z.literal(true),
        })
        .strict()
        .parse(value);
      return prisma.$transaction(
        async (tx) => {
          await lockWorkforceTenant(tx, s);
          await requireWorkforceActor(tx, s);
          const c = await target(tx, s, membershipId);
          assertIndependentWorkforceReview(s.userId, c.member.userId);
          const requestHash = workforceAccountHash({
            membershipId,
            month,
            ...b,
          });
          const retry = await tx.workforceMonthlyClose.findFirst({
            where: {
              tenantId: s.tenantId,
              actorUserId: s.userId,
              idempotencyKey: b.idempotencyKey,
            },
          });
          if (retry) {
            if (
              retry.venueId !== s.venueId ||
              retry.requestHash !== requestHash
            )
              throw new WorkforceError(
                "CONFLICT",
                "Monthly close key was reused for another request.",
              );
            return view(tx, s, membershipId, month, clock());
          }
          if (
            await tx.workforceMonthlyClose.findFirst({
              where: { ...scope(s), userId: c.member.userId, month },
            })
          )
            throw new WorkforceError(
              "CONFLICT",
              "The month is already closed; later changes append adjustments.",
            );
          const a = await openAccount(tx, s, membershipId, month, clock());
          if (a.fingerprint !== b.expectedFingerprint)
            throw new WorkforceError(
              "CONFLICT",
              "Monthly sources changed. Reload and review the complete period again.",
            );
          assertWorkforceMonthlyClose(a.account, clock(), b.reviewConfirmed);
          const id = randomUUID(),
            rule = lastPolicy(a.input),
            audit = await appendWorkforceAudit(
              tx,
              s,
              "WORKFORCE_MONTH_CLOSED",
              id,
              clock(),
              { schemaVersion: 1, sourceHash: a.fingerprint, month },
              "WORKFORCE_MONTHLY",
            );
          await tx.workforceMonthlyClose.create({
            data: {
              id,
              ...scope(s),
              userId: c.member.userId,
              membershipId,
              profileId: c.profile.id,
              month,
              timezone: a.input.timezone,
              version: 1,
              sourceHash: a.fingerprint,
              snapshot: json(a.account),
              frozenContext: json({
                timezone: a.input.timezone,
                contracts: a.input.contracts,
                policies: a.input.policies,
                employmentStartedOn: a.input.employmentStartedOn,
                employmentEndedOn: a.input.employmentEndedOn,
                targetDays: a.account.targetDays,
                carryRule: rule,
                identity: {
                  displayName: c.member.user.displayName,
                  employeeRef: c.profile.employeeRef,
                  venueName: c.venue.name,
                },
              }),
              actorUserId: s.userId,
              reason: b.reason,
              auditEventId: audit.id,
              idempotencyKey: b.idempotencyKey,
              requestHash,
              closedAt: clock(),
              retentionUntil: new Date(
                workforceAccountRetentionUntil(
                  clock(),
                  a.input.timezone,
                  Math.max(
                    rule?.rules.retentionYears ?? 1,
                    ...a.input.policies
                      .filter((p) => a.account.accountPolicyIds.includes(p.id))
                      .map((p) => p.rules.retentionYears),
                  ),
                ),
              ),
            },
          });
          await enqueueWorkforceNotice(tx, {
            ...scope(s),
            userId: c.member.userId,
            eventKey: "MONTH_CLOSED:" + id,
            sourceKind: "MONTHLY_CLOSE",
            subjectId: id,
            requiredPermission: "SELF",
            category: "MONTHLY_STATEMENT",
            link: { tab: "month", month },
            createdAt: clock(),
          });
          return view(tx, s, membershipId, month, clock());
        },
        { timeout: 30000 },
      );
    },
    async logExport(
      s: StaffIdentity,
      membershipId: string,
      month: string,
      format: string,
      version: string,
      fingerprint: string,
    ) {
      assertStaffPermission(s.role, "SCHEDULE_VIEW");
      return prisma.$transaction(async (tx) => {
        await requireWorkforceActor(tx, s);
        const c = await target(tx, s, membershipId);
        await appendWorkforceAudit(
          tx,
          s,
          "WORKFORCE_MONTH_EXPORTED",
          c.profile.id,
          clock(),
          { schemaVersion: 1, month, format, version, fingerprint },
          "WORKFORCE_MONTHLY",
        );
      });
    },
    async statistics(s: StaffIdentity, month: string) {
      assertStaffPermission(s.role, "SCHEDULE_MANAGE");
      workforceMonthSchema.parse(month);
      return prisma.$transaction(
        async (tx) => {
          await requireWorkforceActor(tx, s);
          const members = await tx.membership.findMany({
              where: { ...scope(s), staffProfile: { isNot: null } },
              select: { id: true },
              orderBy: { id: "asc" },
            }),
            team: Awaited<ReturnType<typeof view>>[] = [];
          for (const m of members)
            team.push(await view(tx, s, m.id, month, clock()));
          const totals = team.reduce(
            (n, t) => ({
              plannedMs:
                n.plannedMs === null || t.account.totals.plannedMs === null
                  ? null
                  : n.plannedMs + t.account.totals.plannedMs,
              actualMs: n.actualMs + t.account.totals.actualMs,
              approvedMs: n.approvedMs + t.account.totals.approvedMs,
              creditedMs:
                n.creditedMs === null || t.account.totals.creditedMs === null
                  ? null
                  : n.creditedMs + t.account.totals.creditedMs,
            }),
            {
              plannedMs: 0 as number | null,
              actualMs: 0,
              approvedMs: 0,
              creditedMs: 0 as number | null,
            },
          );
          const planned = (await publishedAssignments(tx, s)).filter((p) => {
            const r = workforceMonthRange(month, p.timezone);
            return (
              Date.parse(p.after.startsAt) < r.end &&
              Date.parse(p.after.endsAt) > r.start
            );
          });
          const stations = [
            ...new Set(planned.map((p) => p.after.station)),
          ].map((station) => {
            const rows = planned.filter((p) => p.after.station === station);
            const presence = (p: (typeof rows)[number]) => {
              const range = workforceMonthRange(month, p.timezone);
              return Math.max(
                0,
                Math.min(Date.parse(p.after.endsAt), range.end) -
                  Math.max(Date.parse(p.after.startsAt), range.start),
              );
            };
            const publishedPresenceMs = rows.reduce(
                (n, p) => n + presence(p),
                0,
              ),
              assignedPresenceMs = rows
                .filter((p) => !!p.after.userId)
                .reduce((n, p) => n + presence(p), 0);
            const actualMs = team.reduce(
              (n, t) =>
                n +
                t.account.entries
                  .filter(
                    (e) => e.category === "ACTUAL" && e.station === station,
                  )
                  .reduce((m, e) => m + e.milliseconds, 0),
              0,
            );
            return {
              station,
              publishedShifts: rows.length,
              openShifts: rows.filter((p) => !p.after.userId).length,
              assignedShifts: rows.filter((p) => !!p.after.userId).length,
              publishedPresenceMs,
              assignedPresenceMs,
              actualMs,
              coverageFraction: publishedPresenceMs
                ? assignedPresenceMs / publishedPresenceMs
                : null,
            };
          });
          const trends = [];
          let trendMonth = month;
          for (let index = 0; index < 3; index++) {
            const monthly =
              index === 0
                ? team
                : await Promise.all(
                    members.map((m) => view(tx, s, m.id, trendMonth, clock())),
                  );
            trends.push({
              month: trendMonth,
              actualMs: monthly.reduce(
                (n, t) => n + t.account.totals.actualMs,
                0,
              ),
              approvedMs: monthly.reduce(
                (n, t) => n + t.account.totals.approvedMs,
                0,
              ),
              creditedMs: monthly.some(
                (t) => t.account.totals.creditedMs === null,
              )
                ? null
                : monthly.reduce((n, t) => n + t.account.totals.creditedMs!, 0),
            });
            trendMonth = workforceAccountPreviousMonth(trendMonth);
          }
          return {
            schemaVersion: 1,
            month,
            totals,
            team: team.map((t) => ({
              employee: t.employee,
              totals: t.account.totals,
              pendingApprovals: t.account.unapprovedAttendanceIds.length,
              pendingRequests: t.account.pendingRequestIds.length,
              warningCodes: t.account.warnings,
              closed: !!t.closing,
              adjustments: t.adjustments.length,
              leaveMinutes: t.account.absences
                .filter((a) => a.status === "APPROVED")
                .reduce((n, a) => n + a.chargedMinutes, 0),
              absenceByCategory: Object.fromEntries(
                [...new Set(t.account.absences.map((a) => a.category))].map(
                  (category) => [
                    category,
                    t.account.absences
                      .filter(
                        (a) =>
                          a.category === category && a.status === "APPROVED",
                      )
                      .reduce((n, a) => n + a.chargedMinutes, 0),
                  ],
                ),
              ),
              deviationMs:
                t.account.totals.plannedMs === null
                  ? null
                  : t.account.totals.actualMs - t.account.totals.plannedMs,
            })),
            stations,
            unallocatedActualMs: team.reduce(
              (n, t) =>
                n +
                t.account.entries
                  .filter((e) => e.category === "ACTUAL" && !e.station)
                  .reduce((m, e) => m + e.milliseconds, 0),
              0,
            ),
            trends,
            ...(s.role === "OWNER"
              ? {
                  laborToSales: {
                    status: "NOT_CONFIGURED",
                    reason:
                      "No approved pay rates are configured; no labor cost or financial ratio is invented.",
                  },
                }
              : {}),
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 60000,
        },
      );
    },
  };
}
export const workforceAccountRepository = createWorkforceAccountRepository();
