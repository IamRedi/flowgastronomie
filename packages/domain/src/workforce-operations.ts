import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import {
  WorkforceError,
  workforceDateSchema,
  workforceLocalSchema,
  workforceAddDays,
  workforceDayRange,
  workforceContractAt,
  workforceWarnings,
  type WorkforceInstantAssignment,
} from "./workforce";
export const workforceKeySchema = z.string().min(8).max(128);
export const workforcePolicyRulesSchema = z
  .object({
    minimumRestMinutes: z.number().int().min(0).max(1440),
    minimumBreakSegmentMinutes: z.number().int().min(0).max(120),
    breakThresholds: z
      .array(
        z
          .object({
            afterMinutes: z.number().int().min(0).max(1440),
            breakMinutes: z.number().int().min(0).max(480),
          })
          .strict(),
      )
      .max(10),
    maximumContinuousMinutes: z.number().int().min(0).max(1440),
    paidBreaksAllowed: z.boolean(),
    managerShiftApproval: z.literal(true),
    excludedLeaveDates: z.array(workforceDateSchema).max(3660).default([]),
    workingWeekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((v) => new Set(v).size === v.length),
    absenceCategories: z
      .array(z.string().regex(/^[A-Z_]{2,40}$/))
      .min(1)
      .max(20),
    legalReviewRequired: z.literal(true),
  })
  .strict();
export type WorkforcePolicyRules = z.infer<typeof workforcePolicyRulesSchema>;
export function workforceDefaultRules(country: string): WorkforcePolicyRules {
  return {
    minimumRestMinutes: 660,
    minimumBreakSegmentMinutes: country === "DE" ? 15 : 0,
    breakThresholds:
      country === "DE"
        ? [
            { afterMinutes: 360, breakMinutes: 30 },
            { afterMinutes: 540, breakMinutes: 45 },
          ]
        : [],
    maximumContinuousMinutes: country === "DE" ? 360 : 0,
    paidBreaksAllowed: false,
    managerShiftApproval: true,
    excludedLeaveDates: [],
    workingWeekdays: [1, 2, 3, 4, 5],
    absenceCategories: ["ANNUAL", "UNPAID", "PERSONAL", "SICKNESS", "OTHER"],
    legalReviewRequired: true,
  };
}
export const workforcePolicyWriteSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    effectiveFrom: workforceDateSchema,
    countryCode: z.enum(["DE", "AL"]),
    reason: z.string().trim().min(3).max(300),
    rules: workforcePolicyRulesSchema,
  })
  .strict();
export type AttendanceState = "WORKING" | "BREAK" | "CLOSED";
export type AttendanceKind =
  "CLOCK_IN" | "BREAK_START" | "BREAK_END" | "CLOCK_OUT" | "CORRECTION";
export type AttendanceBreak = {
  startsAt: string;
  endsAt: string;
  kind: "PAID" | "UNPAID";
};
export type AttendanceSnapshot = {
  startsAt: string;
  endsAt: string;
  breaks: AttendanceBreak[];
};
export type AttendanceEvidence = {
  id: string;
  kind: AttendanceKind;
  occurredAt: string;
  sequence: number;
  payload: { breakKind?: "PAID" | "UNPAID"; snapshot?: AttendanceSnapshot };
};
export const workforcePunchSchema = z
  .object({
    kind: z.enum(["CLOCK_IN", "BREAK_START", "BREAK_END", "CLOCK_OUT"]),
    idempotencyKey: workforceKeySchema,
    expectedVersion: z.number().int().min(0),
    breakKind: z.enum(["PAID", "UNPAID"]).optional(),
    assignmentId: z.string().max(128).optional(),
    operationalStaffShiftId: z.string().max(128).optional(),
  })
  .strict();
export function assertAttendanceTransition(
  state: AttendanceState | null,
  kind: AttendanceKind,
) {
  const allowed =
    state === null
      ? ["CLOCK_IN"]
      : state === "WORKING"
        ? ["BREAK_START", "CLOCK_OUT"]
        : state === "BREAK"
          ? ["BREAK_END"]
          : [];
  if (!allowed.includes(kind))
    throw new WorkforceError(
      "CONFLICT",
      "Invalid clock transition. Reload your current work status.",
      "STATE",
    );
}
export function workforceAttendanceState(
  events: AttendanceEvidence[],
): AttendanceState | null {
  let state: AttendanceState | null = null;
  for (const e of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (e.kind === "CORRECTION") {
      if (e.payload.snapshot) state = "CLOSED";
      continue;
    }
    assertAttendanceTransition(state, e.kind);
    state =
      e.kind === "CLOCK_OUT"
        ? "CLOSED"
        : e.kind === "BREAK_START"
          ? "BREAK"
          : "WORKING";
  }
  return state;
}
export function workforceOriginalAttendance(
  events: AttendanceEvidence[],
  asOf: string,
): AttendanceSnapshot | null {
  let start: string | null = null,
    end: string | null = null,
    open: { startsAt: string; kind: "PAID" | "UNPAID" } | null = null;
  const breaks: AttendanceBreak[] = [];
  for (const e of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (e.kind === "CORRECTION") continue;
    if (e.kind === "CLOCK_IN") start = e.occurredAt;
    if (e.kind === "CLOCK_OUT") end = e.occurredAt;
    if (e.kind === "BREAK_START")
      open = { startsAt: e.occurredAt, kind: e.payload.breakKind ?? "UNPAID" };
    if (e.kind === "BREAK_END" && open) {
      breaks.push({ ...open, endsAt: e.occurredAt });
      open = null;
    }
  }
  if (!start) return null;
  if (open) breaks.push({ ...open, endsAt: end ?? asOf });
  return { startsAt: start, endsAt: end ?? asOf, breaks };
}
export function assertAttendanceSnapshot(
  v: AttendanceSnapshot,
  allowEmpty = false,
) {
  const s = Date.parse(v.startsAt),
    e = Date.parse(v.endsAt);
  if (
    !Number.isFinite(s) ||
    !Number.isFinite(e) ||
    (allowEmpty ? e < s : e <= s)
  )
    throw new WorkforceError(
      "TIME",
      "Use a valid recorded interval of at most seven days.",
    );
  let last = s;
  for (const b of [...v.breaks].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  )) {
    const bs = Date.parse(b.startsAt),
      be = Date.parse(b.endsAt);
    if (
      !Number.isFinite(bs) ||
      !Number.isFinite(be) ||
      bs < last ||
      (allowEmpty ? be < bs : be <= bs) ||
      be > e
    )
      throw new WorkforceError(
        "TIME",
        "Breaks must be positive, non-overlapping intervals inside attendance.",
      );
    last = be;
  }
}
export function workforceAttendanceTotals(v: AttendanceSnapshot) {
  assertAttendanceSnapshot(v, true);
  const presenceMs = Date.parse(v.endsAt) - Date.parse(v.startsAt);
  let paidBreakMs = 0,
    unpaidBreakMs = 0;
  for (const b of v.breaks) {
    const ms = Date.parse(b.endsAt) - Date.parse(b.startsAt);
    if (b.kind === "PAID") paidBreakMs += ms;
    else unpaidBreakMs += ms;
  }
  const workedMs = presenceMs - unpaidBreakMs;
  return {
    presenceMs,
    paidBreakMs,
    unpaidBreakMs,
    workedMs,
    presenceMinutes: Math.floor(presenceMs / 60000),
    breakMinutes: Math.floor((paidBreakMs + unpaidBreakMs) / 60000),
    paidBreakMinutes: Math.floor(paidBreakMs / 60000),
    unpaidBreakMinutes: Math.floor(unpaidBreakMs / 60000),
    workedMinutes: Math.floor(workedMs / 60000),
  };
}
export function workforceAttendanceWarnings(
  v: AttendanceSnapshot,
  r: WorkforcePolicyRules,
  previousEnd?: string,
) {
  const totals = workforceAttendanceTotals(v),
    warnings: string[] = [];
  const segments = v.breaks.filter(
    (b) =>
      Date.parse(b.endsAt) - Date.parse(b.startsAt) >=
      r.minimumBreakSegmentMinutes * 60000,
  );
  const qualifying = segments.reduce(
    (n, b) => n + Date.parse(b.endsAt) - Date.parse(b.startsAt),
    0,
  );
  const actualWorkingMs =
    totals.presenceMs - totals.paidBreakMs - totals.unpaidBreakMs;
  const required = Math.max(
    0,
    ...r.breakThresholds
      .filter((t) => actualWorkingMs > t.afterMinutes * 60000)
      .map((t) => t.breakMinutes),
  );
  if (qualifying < required * 60000) warnings.push("BREAK_SHORT");
  if (r.maximumContinuousMinutes) {
    let last = Date.parse(v.startsAt);
    for (const b of [...segments].sort((a, b) =>
      a.startsAt.localeCompare(b.startsAt),
    )) {
      if (Date.parse(b.startsAt) - last > r.maximumContinuousMinutes * 60000)
        warnings.push("CONTINUOUS_WORK");
      last = Date.parse(b.endsAt);
    }
    if (Date.parse(v.endsAt) - last > r.maximumContinuousMinutes * 60000)
      warnings.push("CONTINUOUS_WORK");
  }
  if (
    previousEnd &&
    Date.parse(v.startsAt) - Date.parse(previousEnd) <
      r.minimumRestMinutes * 60000
  )
    warnings.push("REST_SHORT");
  if (totals.presenceMs > 16 * 3600000) warnings.push("LONG_SESSION");
  return [...new Set(warnings)];
}
// Employee-proposed times permit minute precision, with explicit fold choices.
export function workforceRecordedInstant(
  local: string,
  timezone: string,
  choice: "reject" | "earlier" | "later" = "reject",
) {
  try {
    const value = Temporal.PlainDateTime.from(local),
      early = value.toZonedDateTime(timezone, { disambiguation: "earlier" }),
      late = value.toZonedDateTime(timezone, { disambiguation: "later" });
    if (
      !early.toPlainDateTime().equals(value) ||
      !late.toPlainDateTime().equals(value)
    )
      throw new Error("gap");
    if (
      early.epochMilliseconds !== late.epochMilliseconds &&
      choice === "reject"
    )
      throw new Error("fold");
    return new Date(
      (choice === "later" ? late : early).epochMilliseconds,
    ).toISOString();
  } catch {
    throw new WorkforceError(
      "TIME",
      "Invalid or repeated local time. Choose its offset explicitly for DST.",
    );
  }
}
const choice = z.enum(["reject", "earlier", "later"]).default("reject");
export const workforceCorrectionSchema = z
  .object({
    idempotencyKey: workforceKeySchema,
    attendanceId: z.string().max(128).nullable(),
    expectedAttendanceVersion: z.number().int().min(0),
    reason: z.enum([
      "MISSING_IN",
      "MISSING_OUT",
      "BREAK",
      "INTERVAL",
      "UNSCHEDULED",
    ]),
    startsLocal: workforceLocalSchema,
    endsLocal: workforceLocalSchema,
    startChoice: choice,
    endChoice: choice,
    breaks: z
      .array(
        z
          .object({
            startsLocal: workforceLocalSchema,
            endsLocal: workforceLocalSchema,
            startChoice: choice,
            endChoice: choice,
            kind: z.enum(["PAID", "UNPAID"]),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export function workforceCorrectionSnapshot(
  input: z.infer<typeof workforceCorrectionSchema>,
  timezone: string,
): AttendanceSnapshot {
  const v = {
    startsAt: workforceRecordedInstant(
      input.startsLocal,
      timezone,
      input.startChoice,
    ),
    endsAt: workforceRecordedInstant(
      input.endsLocal,
      timezone,
      input.endChoice,
    ),
    breaks: input.breaks.map((b) => ({
      startsAt: workforceRecordedInstant(
        b.startsLocal,
        timezone,
        b.startChoice,
      ),
      endsAt: workforceRecordedInstant(b.endsLocal, timezone, b.endChoice),
      kind: b.kind,
    })),
  };
  assertAttendanceSnapshot(v);
  return v;
}
export function assertIndependentWorkforceReview(
  actorUserId: string,
  targetUserId: string,
) {
  if (actorUserId === targetUserId)
    throw new WorkforceError(
      "APPROVAL",
      "Another authorized manager must review your own worked time or leave.",
      "REVIEW",
    );
}
export const workforceLeaveSchema = z
  .object({
    idempotencyKey: workforceKeySchema,
    category: z.string().regex(/^[A-Z_]{2,40}$/),
    from: workforceDateSchema,
    to: workforceDateSchema,
    partial: z
      .object({
        startsLocal: workforceLocalSchema,
        endsLocal: workforceLocalSchema,
        startChoice: choice,
        endChoice: choice,
      })
      .strict()
      .nullable(),
  })
  .strict();
export type LeaveSlice = {
  date: string;
  year: number;
  startsAt: string;
  endsAt: string;
  chargedMinutes: number;
  contractRevisionId: string;
  policyRevisionId: string;
};
export type WorkforcePolicyVersion = {
  id: string;
  version: number;
  effectiveFrom: string;
  countryCode: string;
  rules: WorkforcePolicyRules;
};
export function workforcePolicyAt(
  versions: WorkforcePolicyVersion[],
  date: string,
) {
  const p = [...versions]
    .filter((p) => p.effectiveFrom <= date)
    .sort(
      (a, b) =>
        b.effectiveFrom.localeCompare(a.effectiveFrom) || b.version - a.version,
    )[0];
  if (!p)
    throw new WorkforceError(
      "INVALID",
      "Configure an effective workforce policy for this period first.",
      "POLICY",
    );
  return p;
}
export function workforceLeaveSlices(
  input: z.infer<typeof workforceLeaveSchema>,
  timezone: string,
  contracts: {
    id: string;
    version: number;
    effectiveFrom: string;
    weeklyTargetMinutes: number;
    countryCode: string;
  }[],
  policies: WorkforcePolicyVersion[],
): LeaveSlice[] {
  if (input.to < input.from || input.to > workforceAddDays(input.from, 92))
    throw new WorkforceError(
      "TIME",
      "Choose an absence period of at most 93 days.",
    );
  if (
    input.partial &&
    (input.from !== input.to ||
      input.partial.startsLocal.slice(0, 10) !== input.from ||
      input.partial.endsLocal.slice(0, 10) !== input.from)
  )
    throw new WorkforceError(
      "TIME",
      "Partial leave must stay within its selected calendar day.",
    );
  const slices: LeaveSlice[] = [];
  for (
    let date = input.from;
    date <= input.to;
    date = workforceAddDays(date, 1)
  ) {
    const p = workforcePolicyAt(policies, date),
      c = workforceContractAt(contracts, date);
    if (!c || c.weeklyTargetMinutes <= 0)
      throw new WorkforceError(
        "INVALID",
        "An effective contract with a reliable working-time target is required.",
      );
    if (p.countryCode !== c.countryCode)
      throw new WorkforceError(
        "INVALID",
        "Employment country and effective workforce policy must match.",
      );
    if (!p.rules.absenceCategories.includes(input.category))
      throw new WorkforceError(
        "INVALID",
        "This absence category is not configured.",
      );
    const day = Temporal.PlainDate.from(date).dayOfWeek;
    const range = workforceDayRange(date, timezone);
    const startsAt = input.partial
      ? workforceRecordedInstant(
          input.partial.startsLocal,
          timezone,
          input.partial.startChoice,
        )
      : new Date(range.start).toISOString();
    const endsAt = input.partial
      ? workforceRecordedInstant(
          input.partial.endsLocal,
          timezone,
          input.partial.endChoice,
        )
      : new Date(range.end).toISOString();
    if (endsAt <= startsAt)
      throw new WorkforceError("TIME", "Absence must end after its start.");
    const target = c.weeklyTargetMinutes / p.rules.workingWeekdays.length;
    if (!Number.isInteger(target))
      throw new WorkforceError(
        "INVALID",
        "Configure a weekly target divisible by the explicit working-day count.",
      );
    const chargedMinutes = input.partial
      ? (Date.parse(endsAt) - Date.parse(startsAt)) / 60000
      : p.rules.workingWeekdays.includes(day) &&
          !p.rules.excludedLeaveDates.includes(date)
        ? target
        : 0;
    if (input.partial && chargedMinutes > target)
      throw new WorkforceError(
        "TIME",
        "Partial-day leave exceeds the configured daily target.",
      );
    slices.push({
      date,
      year: Number(date.slice(0, 4)),
      startsAt,
      endsAt,
      chargedMinutes,
      contractRevisionId: c.id,
      policyRevisionId: p.id,
    });
  }
  return slices;
}
export const workforceShiftRequestSchema = z
  .object({
    idempotencyKey: workforceKeySchema,
    kind: z.enum(["SWAP", "OFFER", "OPEN"]),
    assignmentId: z.string().min(1).max(128),
    publicationRevisionId: z.string().min(1).max(128),
    targetMembershipId: z.string().min(1).max(128).nullable(),
    otherAssignmentId: z.string().min(1).max(128).nullable(),
    otherPublicationRevisionId: z.string().min(1).max(128).nullable(),
  })
  .strict();
export type WorkforceRequestStatus =
  "PENDING" | "ACCEPTED" | "APPROVED" | "REJECTED" | "CANCELLED";
export const workforceRequestDecisionSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    action: z.enum([
      "ACCEPT",
      "DECLINE",
      "WITHDRAW",
      "APPROVE",
      "REJECT",
      "CANCEL_APPROVED",
    ]),
    reason: z.string().trim().max(300).default(""),
    reviewConfirmed: z.boolean().default(false),
    warningsAcknowledged: z.boolean().default(false),
  })
  .strict();
export function workforceRequestTransition(
  status: WorkforceRequestStatus,
  action: string,
  kind: string,
) {
  if (
    action === "ACCEPT" &&
    status === "PENDING" &&
    ["SWAP", "OFFER"].includes(kind)
  )
    return "ACCEPTED" as const;
  if (
    action === "DECLINE" &&
    status === "PENDING" &&
    ["SWAP", "OFFER"].includes(kind)
  )
    return "REJECTED" as const;
  if (action === "WITHDRAW" && ["PENDING", "ACCEPTED"].includes(status))
    return "CANCELLED" as const;
  if (
    action === "APPROVE" &&
    ((status === "PENDING" && !["SWAP", "OFFER"].includes(kind)) ||
      status === "ACCEPTED")
  )
    return "APPROVED" as const;
  if (action === "REJECT" && ["PENDING", "ACCEPTED"].includes(status))
    return "REJECTED" as const;
  if (action === "CANCEL_APPROVED" && status === "APPROVED" && kind === "LEAVE")
    return "CANCELLED" as const;
  throw new WorkforceError(
    "CONFLICT",
    "Request state changed or this transition is unavailable.",
  );
}
export function assertWorkforceShiftEligibility(
  assignment: WorkforceInstantAssignment,
  profile: Parameters<typeof workforceWarnings>[1][number],
  unavailable: Parameters<typeof workforceWarnings>[2],
) {
  const warnings = workforceWarnings([assignment], [profile], unavailable);
  if (warnings.length)
    throw new WorkforceError(
      "CONFLICT",
      "Worker qualifications, station, availability or approved absence conflict with this shift.",
      "INELIGIBLE",
    );
}
export function workforceShiftRestWarnings(
  assignments: WorkforceInstantAssignment[],
  minimumRestMinutes: number,
) {
  const warnings: string[] = [];
  const sorted = [...assignments].sort(
    (a, b) =>
      (a.userId ?? "").localeCompare(b.userId ?? "") ||
      a.startsAt.localeCompare(b.startsAt),
  );
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!,
      b = sorted[i]!;
    if (
      a.userId === b.userId &&
      Date.parse(b.startsAt) - Date.parse(a.endsAt) < minimumRestMinutes * 60000
    )
      warnings.push("REST_SHORT");
  }
  return [...new Set(warnings)];
}
export const workforceLeaveGrantSchema = z
  .object({
    membershipId: z.string().min(1).max(128),
    year: z.number().int().min(2000).max(2200),
    minutes: z
      .number()
      .int()
      .min(-527040)
      .max(527040)
      .refine((n) => n !== 0),
    expectedVersion: z.number().int().min(0),
    reason: z.string().trim().min(3).max(300),
    idempotencyKey: workforceKeySchema,
  })
  .strict();
export type WorkforceOperationsIntentV1 = {
  schemaVersion: 1;
  eventId: string;
  type: string;
  tenantId: string;
  venueId: string;
  subjectId: string;
  actorUserId: string;
  occurredAt: string;
  recipientUserIds: string[];
  permission: "WORKFORCE_SELF_OR_VENUE_MANAGER";
  auditEventId: string;
};
export type WorkforceApprovedAttendanceV1 = {
  schemaVersion: 1;
  attendanceId: string;
  approvalId: string;
  tenantId: string;
  venueId: string;
  userId: string;
  membershipId: string;
  timezone: string;
  contractRevisionId: string | null;
  policyRevisionId: string;
  sourceEventIds: string[];
  correctionRequestId: string | null;
  snapshot: AttendanceSnapshot;
  totals: ReturnType<typeof workforceAttendanceTotals>;
  approvedByUserId: string;
  approvedAt: string;
};
export function workforceAttendanceWindowTotals(
  v: AttendanceSnapshot,
  from: number,
  to: number,
) {
  const start = Math.max(Date.parse(v.startsAt), from),
    end = Math.min(Date.parse(v.endsAt), to);
  if (end <= start)
    return {
      presenceMs: 0,
      paidBreakMs: 0,
      unpaidBreakMs: 0,
      workedMs: 0,
      presenceMinutes: 0,
      breakMinutes: 0,
      paidBreakMinutes: 0,
      unpaidBreakMinutes: 0,
      workedMinutes: 0,
    };
  const clipped: AttendanceSnapshot = {
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    breaks: v.breaks.flatMap((b) => {
      const s = Math.max(Date.parse(b.startsAt), start),
        e = Math.min(Date.parse(b.endsAt), end);
      return e > s
        ? [
            {
              startsAt: new Date(s).toISOString(),
              endsAt: new Date(e).toISOString(),
              kind: b.kind,
            },
          ]
        : [];
    }),
  };
  return workforceAttendanceTotals(clipped);
}

export function workforceSumAttendanceTotals(
  values: ReturnType<typeof workforceAttendanceTotals>[],
) {
  const sum = values.reduce(
    (s, v) => ({
      presenceMs: s.presenceMs + v.presenceMs,
      paidBreakMs: s.paidBreakMs + v.paidBreakMs,
      unpaidBreakMs: s.unpaidBreakMs + v.unpaidBreakMs,
      workedMs: s.workedMs + v.workedMs,
    }),
    { presenceMs: 0, paidBreakMs: 0, unpaidBreakMs: 0, workedMs: 0 },
  );
  return {
    ...sum,
    presenceMinutes: Math.floor(sum.presenceMs / 60000),
    breakMinutes: Math.floor((sum.paidBreakMs + sum.unpaidBreakMs) / 60000),
    paidBreakMinutes: Math.floor(sum.paidBreakMs / 60000),
    unpaidBreakMinutes: Math.floor(sum.unpaidBreakMs / 60000),
    workedMinutes: Math.floor(sum.workedMs / 60000),
  };
}
export function assertWorkforceLeaveAllowance(
  configured: boolean,
  allowanceMinutes: number | null,
  usedMinutes: number,
  requestedMinutes: number,
) {
  if (
    !configured ||
    allowanceMinutes === null ||
    allowanceMinutes - usedMinutes < requestedMinutes ||
    allowanceMinutes < 0
  )
    throw new WorkforceError(
      "CONFLICT",
      "A documented annual allowance with sufficient remaining minutes is required.",
      "ALLOWANCE",
    );
}
export function assertWorkforcePolicyDate(
  effectiveFrom: string,
  previous: { effectiveFrom: string } | null,
  today: string,
) {
  if (
    previous &&
    (effectiveFrom < today || effectiveFrom < previous.effectiveFrom)
  )
    throw new WorkforceError(
      "PAST",
      "Later policy changes cannot rewrite past periods.",
    );
}
export function assertWorkforceCorrectionPeriod(
  snapshot: AttendanceSnapshot,
  now: string,
) {
  if (
    Date.parse(snapshot.endsAt) > Date.parse(now) ||
    Date.parse(snapshot.endsAt) - Date.parse(snapshot.startsAt) > 7 * 86400000
  )
    throw new WorkforceError(
      "TIME",
      "Corrections describe completed work of at most seven days, never future work.",
    );
}
export type WorkforceRequestAction =
  "ACCEPT" | "DECLINE" | "WITHDRAW" | "APPROVE" | "REJECT" | "CANCEL_APPROVED";
export function workforceRequestActions(
  request: {
    kind: string;
    status: string;
    userId: string;
    invitedUserId: string | null;
    createdByUserId?: string;
  },
  viewer: { userId: string; canManage: boolean },
): WorkforceRequestAction[] {
  const actions: WorkforceRequestAction[] = [];
  if (
    request.status === "PENDING" &&
    request.invitedUserId === viewer.userId &&
    ["SWAP", "OFFER"].includes(request.kind)
  )
    actions.push("ACCEPT", "DECLINE");
  if (
    ["PENDING", "ACCEPTED"].includes(request.status) &&
    (request.userId === viewer.userId ||
      (request.kind === "CORRECTION" &&
        request.createdByUserId === viewer.userId))
  )
    actions.push("WITHDRAW");
  if (
    viewer.canManage &&
    request.userId !== viewer.userId &&
    request.invitedUserId !== viewer.userId
  ) {
    if (["PENDING", "ACCEPTED"].includes(request.status)) {
      actions.push("REJECT");
      if (
        request.status === "ACCEPTED" ||
        !["SWAP", "OFFER"].includes(request.kind)
      )
        if (!(
          request.kind === "CORRECTION" &&
          request.createdByUserId === viewer.userId
        ))
          actions.push("APPROVE");
    }
    if (request.status === "APPROVED" && request.kind === "LEAVE")
      actions.push("CANCEL_APPROVED");
  }
  return actions;
}
