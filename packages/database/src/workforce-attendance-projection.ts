import { Prisma } from "@prisma/client";
import {
  workforceOriginalAttendance,
  workforceAttendanceTotals,
  type AttendanceEvidence,
} from "@flowgastronomie/domain";
export type WorkforceAttendanceRecord = Prisma.WorkforceAttendanceGetPayload<{
  include: { events: true; approvals: true };
}>;
export const workforceAttendanceInclude = {
  events: { orderBy: { sequence: "asc" as const } },
  approvals: { orderBy: { attendanceVersion: "desc" as const }, take: 20 },
};
export function workforceAttendanceEvidence(
  a: WorkforceAttendanceRecord,
): AttendanceEvidence[] {
  return a.events.map((e) => ({
    id: e.id,
    kind: e.kind as AttendanceEvidence["kind"],
    occurredAt: e.occurredAt.toISOString(),
    sequence: e.sequence,
    payload: e.payload as AttendanceEvidence["payload"],
  }));
}
export function workforceCurrentApproval(a: WorkforceAttendanceRecord) {
  return a.approvals.find((v) => v.attendanceVersion === a.version) ?? null;
}
export function workforceAttendanceProjection(
  a: WorkforceAttendanceRecord,
  now: Date,
) {
  const events = workforceAttendanceEvidence(a),
    cutoff =
      a.state === "CLOSED"
        ? ([...events].reverse().find((e) => e.kind === "CORRECTION")
            ?.occurredAt ?? now.toISOString())
        : now.toISOString(),
    original = workforceOriginalAttendance(events, cutoff),
    approval = workforceCurrentApproval(a);
  const latestCorrection =
    [...events].reverse().find((e) => e.kind === "CORRECTION")?.payload
      .snapshot ?? null;
  const actual = latestCorrection ?? original;
  return {
    id: a.id,
    userId: a.userId,
    membershipId: a.membershipId,
    venueId: a.venueId,
    timezone: a.timezone,
    state: a.state,
    version: a.version,
    startedAt: a.startedAt.toISOString(),
    contractRevisionId: a.contractRevisionId,
    policyRevisionId: a.policyRevisionId,
    publishedAssignmentRevisionId: a.publishedAssignmentRevisionId,
    operationalStaffShiftId: a.operationalStaffShiftId,
    original,
    actual,
    totals: actual ? workforceAttendanceTotals(actual) : null,
    events: events.map((e) => ({
      ...e,
      recordedAt: a.events.find((x) => x.id === e.id)!.recordedAt.toISOString(),
      actorUserId: a.events.find((x) => x.id === e.id)!.actorUserId,
    })),
    approved: approval
      ? {
          id: approval.id,
          attendanceVersion: approval.attendanceVersion,
          snapshot: approval.snapshot,
          totals: approval.calculation,
          sourceEventIds: approval.sourceEventIds,
          actorUserId: approval.actorUserId,
          createdAt: approval.createdAt.toISOString(),
          reason: approval.reason,
          correctionRequestId: approval.correctionRequestId,
        }
      : null,
    approvalHistory: a.approvals.map((p) => ({
      id: p.id,
      attendanceVersion: p.attendanceVersion,
      snapshot: p.snapshot,
      totals: p.calculation,
      actorUserId: p.actorUserId,
      createdAt: p.createdAt.toISOString(),
      reason: p.reason,
    })),
  };
}

/** Shared canonical effective interval discovery. Optional venue omission is
 * reserved for internal cross-venue conflict/suppression checks, never a staff
 * response scope. All report callers supply their authenticated venue. */
export async function workforceAttendanceIdsInWindow(
  tx: Prisma.TransactionClient,
  scope: { tenantId: string; venueId?: string; userId: string },
  range: { start: number; end: number },
  now: Date,
) {
  const venueId = scope.venueId ?? null;
  return tx.$queryRaw<
    { id: string }[]
  >`SELECT a.id FROM "WorkforceAttendance" a LEFT JOIN LATERAL (SELECT e.payload FROM "WorkforceAttendanceEvent" e WHERE e."attendanceId"=a.id AND e.kind='CORRECTION' ORDER BY e.sequence DESC LIMIT 1) correction ON true LEFT JOIN LATERAL (SELECT e."occurredAt" FROM "WorkforceAttendanceEvent" e WHERE e."attendanceId"=a.id AND e.kind='CLOCK_OUT' ORDER BY e.sequence DESC LIMIT 1) last_out ON true WHERE a."tenantId"=${scope.tenantId} AND (${venueId}::text IS NULL OR a."venueId"=${venueId}) AND a."userId"=${scope.userId} AND COALESCE(((correction.payload->'snapshot'->>'startsAt')::timestamptz AT TIME ZONE 'UTC'),a."startedAt")<${new Date(range.end)} AND COALESCE(((correction.payload->'snapshot'->>'endsAt')::timestamptz AT TIME ZONE 'UTC'),last_out."occurredAt",${now})>${new Date(range.start)} ORDER BY a.id`;
}
