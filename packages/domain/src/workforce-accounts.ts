import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import {
  WorkforceError,
  workforceDateSchema,
  workforceDayRange,
  workforceAddDays,
  workforceContractAt,
  type WorkforceInstantAssignment,
} from "./workforce";
import {
  workforceAttendanceWindowTotals,
  workforceSumAttendanceTotals,
  type AttendanceSnapshot,
  type LeaveSlice,
} from "./workforce-operations";

export const workforceMonthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .refine((v) => {
    try {
      Temporal.PlainYearMonth.from(v);
      return true;
    } catch {
      return false;
    }
  });
export function workforceAccountMonthDays(month: string) {
  workforceMonthSchema.parse(month);
  const first = Temporal.PlainYearMonth.from(month).toPlainDate({ day: 1 });
  return Array.from({ length: first.daysInMonth }, (_, i) =>
    first.add({ days: i }).toString(),
  );
}
export function workforceMonthRange(month: string, timezone: string) {
  const days = workforceAccountMonthDays(month);
  return {
    from: days[0]!,
    to: days[days.length - 1]!,
    start: workforceDayRange(days[0]!, timezone).start,
    end: workforceDayRange(days[days.length - 1]!, timezone).end,
  };
}
export const workforceAccountRulesSchema = z
  .object({
    timezone: z
      .string()
      .max(80)
      .refine((v) => {
        try {
          workforceDayRange("2026-01-01", v);
          return true;
        } catch {
          return false;
        }
      }),
    workingWeekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((v) => new Set(v).size === v.length),
    targetBasis: z.enum(["WEEKLY_WORKDAYS", "MONTHLY_WORKDAYS"]),
    plannedBreakTreatment: z.enum(["PAID", "UNPAID"]),
    plannedBreakAllocation: z.literal("PROPORTIONAL"),
    paidLeaveCategories: z
      .array(z.enum(["ANNUAL", "PERSONAL", "SICKNESS", "OTHER"]))
      .max(4)
      .refine((v) => new Set(v).size === v.length),
    holidays: z
      .array(
        z
          .object({
            date: workforceDateSchema,
            label: z.string().trim().min(1).max(100),
          })
          .strict(),
      )
      .max(400)
      .refine((v) => new Set(v.map((h) => h.date)).size === v.length),
    creditOverlapRule: z.enum(["LIMIT_TO_TARGET", "EXCLUDE_RECORDED_WORK"]),
    overtimeBasis: z.enum([
      "DISABLED",
      "APPROVED_OVER_TARGET",
      "EARNED_OVER_TARGET",
    ]),
    carryoverMode: z.enum(["NONE", "BALANCE"]),
    carryPositiveLimitMinutes: z.number().int().min(0).max(446400).nullable(),
    carryNegativeLimitMinutes: z.number().int().min(0).max(446400).nullable(),
    openingMonth: workforceMonthSchema.nullable(),
    openingBalanceMinutes: z.number().int().min(-446400).max(446400),
    retentionYears: z.number().int().min(1).max(30),
    legalReviewConfirmed: z.literal(true),
  })
  .strict()
  .refine((v) => v.carryoverMode !== "BALANCE" || v.openingMonth !== null, {
    message: "Confirm the first carryover month and opening balance.",
  });
export type WorkforceAccountRules = z.infer<typeof workforceAccountRulesSchema>;
export const workforceAccountPolicyWriteSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    effectiveFrom: workforceDateSchema,
    countryCode: z.enum(["DE", "AL"]),
    rules: workforceAccountRulesSchema,
    reason: z.string().trim().min(3).max(300),
    reviewConfirmed: z.literal(true),
  })
  .strict()
  .refine((v) => v.countryCode !== "DE" || v.rules.retentionYears >= 2, {
    message:
      "DE evidence configuration requires at least two years; legal applicability still needs review.",
  });
export type WorkforceAccountPolicy = {
  id: string;
  version: number;
  effectiveFrom: string;
  countryCode: string;
  rules: WorkforceAccountRules;
  createdByUserId: string;
  createdAt: string;
};
export type WorkforceAccountContract = {
  id: string;
  version: number;
  effectiveFrom: string;
  countryCode: string;
  weeklyTargetMinutes: number;
  monthlyTargetMinutes: number | null;
  createdByUserId: string;
  createdAt: string;
};
export type WorkforceMonthlyReference = {
  sourceId: string;
  sourceKind: string;
  contractRevisionId: string | null;
  policyRevisionId: string | null;
  accountPolicyRevisionId: string | null;
  actorUserId: string | null;
  occurredAt: string | null;
  sourceEventIds?: string[];
  scheduleRevisionId?: string;
  attendanceId?: string;
  publishedAssignmentRevisionId?: string | null;
  approvalId?: string;
  leaveDecisionId?: string;
};
export type WorkforceMonthlyEntry = WorkforceMonthlyReference & {
  category: "PLANNED" | "ACTUAL" | "APPROVED" | "CREDITED" | "TARGET";
  date: string;
  minutes: number;
  milliseconds: number;
  station?: string;
  breakMs?: number;
  paidBreakMs?: number;
  unpaidBreakMs?: number;
  detail: string;
};
export type WorkforceAccountTargetDay = {
  date: string;
  milliseconds: number | null;
  contractRevisionId: string | null;
  accountPolicyRevisionId: string | null;
  countryCode: string | null;
};
export type WorkforceMonthlyAttendance = {
  id: string;
  state: string;
  version: number;
  timezone: string;
  contractRevisionId: string | null;
  policyRevisionId: string;
  sourceEventIds: string[];
  snapshot: AttendanceSnapshot | null;
  recordedAt: string;
  actorUserId: string;
  publishedAssignmentRevisionId?: string | null;
  scheduleRevisionId?: string;
  station?: string;
  approval: {
    id: string;
    snapshot: AttendanceSnapshot;
    sourceEventIds: string[];
    actorUserId: string;
    createdAt: string;
    contractRevisionId: string | null;
    policyRevisionId: string;
  } | null;
};
export type WorkforceMonthlyLeave = {
  id: string;
  category: string;
  status: string;
  slices: LeaveSlice[];
  decisionId: string;
  actorUserId: string;
  occurredAt: string;
};
export type WorkforceMonthlyInput = {
  month: string;
  timezone: string;
  employmentStartedOn: string | null;
  employmentEndedOn: string | null;
  contracts: WorkforceAccountContract[];
  policies: WorkforceAccountPolicy[];
  planned: {
    id: string;
    scheduleRevisionId: string;
    assignment: WorkforceInstantAssignment;
    actorUserId: string;
    createdAt: string;
  }[];
  attendance: WorkforceMonthlyAttendance[];
  leave: WorkforceMonthlyLeave[];
  pendingRequestIds: string[];
  carryMs: number | null;
  carrySourceIds: string[];
  frozenTargetDays?: WorkforceAccountTargetDay[];
};
export function workforceAccountPolicyAt(
  policies: WorkforceAccountPolicy[],
  date: string,
  countryCode: string,
) {
  return (
    policies
      .filter((p) => p.countryCode === countryCode && p.effectiveFrom <= date)
      .sort(
        (a, b) =>
          b.effectiveFrom.localeCompare(a.effectiveFrom) ||
          b.version - a.version,
      )[0] ?? null
  );
}
function dailyTarget(
  contract: WorkforceAccountContract,
  policy: WorkforceAccountPolicy,
  date: string,
) {
  const day = Temporal.PlainDate.from(date);
  if (!policy.rules.workingWeekdays.includes(day.dayOfWeek)) return 0;
  const n =
    policy.rules.targetBasis === "WEEKLY_WORKDAYS"
      ? policy.rules.workingWeekdays.length
      : workforceAccountMonthDays(date.slice(0, 7)).filter((d) =>
          policy.rules.workingWeekdays.includes(
            Temporal.PlainDate.from(d).dayOfWeek,
          ),
        ).length;
  const minutes =
    policy.rules.targetBasis === "WEEKLY_WORKDAYS"
      ? contract.weeklyTargetMinutes
      : contract.monthlyTargetMinutes;
  return minutes === null ? null : (minutes * 60000) / n;
}
export function workforceCarryMilliseconds(
  balanceMs: number,
  rules: WorkforceAccountRules,
) {
  if (rules.carryoverMode === "NONE") return 0;
  return balanceMs >= 0
    ? Math.min(
        balanceMs,
        rules.carryPositiveLimitMinutes === null
          ? Infinity
          : rules.carryPositiveLimitMinutes * 60000,
      )
    : Math.max(
        balanceMs,
        rules.carryNegativeLimitMinutes === null
          ? -Infinity
          : -rules.carryNegativeLimitMinutes * 60000,
      );
}
/** Complete canonical inputs only. No UI row limit, rounding per record, inferred holiday or wage rate. */
export function workforceMonthlyAccount(input: WorkforceMonthlyInput) {
  for (const rows of [input.planned, input.attendance, input.leave])
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      throw new WorkforceError(
        "INVALID",
        "Duplicate canonical monthly source.",
      );
  const range = workforceMonthRange(input.month, input.timezone),
    days = workforceAccountMonthDays(input.month),
    entries: WorkforceMonthlyEntry[] = [],
    warnings = new Set<string>();
  const targetDays: WorkforceAccountTargetDay[] =
    input.frozenTargetDays ??
    days.map((date) => {
      if (
        (input.employmentStartedOn && date < input.employmentStartedOn) ||
        (input.employmentEndedOn && date > input.employmentEndedOn)
      )
        return {
          date,
          milliseconds: 0,
          contractRevisionId: null,
          accountPolicyRevisionId: null,
          countryCode: null,
        };
      const contract = workforceContractAt(input.contracts, date),
        policy = contract
          ? workforceAccountPolicyAt(input.policies, date, contract.countryCode)
          : null;
      if (!contract) warnings.add("CONTRACT_UNCONFIGURED");
      else if (!policy) warnings.add("ACCOUNT_POLICY_UNCONFIGURED");
      const milliseconds =
        contract && policy ? dailyTarget(contract, policy, date) : null;
      if (milliseconds === null && contract && policy)
        warnings.add("TARGET_UNCONFIGURED");
      return {
        date,
        milliseconds,
        contractRevisionId: contract?.id ?? null,
        accountPolicyRevisionId: policy?.id ?? null,
        countryCode: contract?.countryCode ?? null,
      };
    });
  const add = (e: Omit<WorkforceMonthlyEntry, "minutes">) =>
    entries.push({ ...e, minutes: e.milliseconds / 60000 });
  for (const target of targetDays)
    if (target.milliseconds !== null && target.contractRevisionId) {
      const contract = input.contracts.find(
        (c) => c.id === target.contractRevisionId,
      );
      add({
        category: "TARGET",
        date: target.date,
        sourceId: target.contractRevisionId,
        sourceKind: "CONTRACT_TARGET",
        contractRevisionId: target.contractRevisionId,
        policyRevisionId: null,
        accountPolicyRevisionId: target.accountPolicyRevisionId,
        actorUserId: contract?.createdByUserId ?? null,
        occurredAt: contract?.createdAt ?? null,
        milliseconds: target.milliseconds,
        detail: "Confirmed contract allocation",
      });
    }
  for (const source of input.planned) {
    const a = source.assignment,
      start = Math.max(Date.parse(a.startsAt), range.start),
      end = Math.min(Date.parse(a.endsAt), range.end);
    if (end <= start) continue;
    const contract = workforceContractAt(
        input.contracts,
        a.startsLocal.slice(0, 10),
      ),
      policy = contract
        ? workforceAccountPolicyAt(
            input.policies,
            a.startsLocal.slice(0, 10),
            contract.countryCode,
          )
        : null;
    if (!policy) {
      warnings.add("PLANNED_BREAK_RULE_UNCONFIGURED");
      continue;
    }
    const gross = Date.parse(a.endsAt) - Date.parse(a.startsAt),
      breakMs =
        policy.rules.plannedBreakTreatment === "UNPAID"
          ? a.breakMinutes * 60000
          : 0;
    if (gross <= 0 || breakMs > gross)
      throw new WorkforceError(
        "INVALID",
        "Invalid published planning interval.",
      );
    add({
      category: "PLANNED",
      date: Temporal.Instant.fromEpochMilliseconds(start)
        .toZonedDateTimeISO(input.timezone)
        .toPlainDate()
        .toString(),
      sourceId: source.id,
      sourceKind: "PUBLISHED_ASSIGNMENT",
      scheduleRevisionId: source.scheduleRevisionId,
      contractRevisionId: contract?.id ?? null,
      policyRevisionId: null,
      accountPolicyRevisionId: policy.id,
      actorUserId: source.actorUserId,
      occurredAt: source.createdAt,
      milliseconds: ((end - start) * (gross - breakMs)) / gross,
      breakMs: ((end - start) * a.breakMinutes * 60000) / gross,
      station: a.station,
      detail: policy.rules.plannedBreakTreatment + " / PROPORTIONAL",
    });
  }
  const actualTotals = [],
    approvedTotals = [],
    unapprovedIds: string[] = [];
  for (const a of input.attendance) {
    if (a.snapshot) {
      const t = workforceAttendanceWindowTotals(
        a.snapshot,
        range.start,
        range.end,
      );
      if (t.presenceMs > 0) {
        actualTotals.push(t);
        add({
          category: "ACTUAL",
          date: Temporal.Instant.fromEpochMilliseconds(
            Math.max(Date.parse(a.snapshot.startsAt), range.start),
          )
            .toZonedDateTimeISO(input.timezone)
            .toPlainDate()
            .toString(),
          sourceId: a.id,
          sourceKind: "ATTENDANCE",
          attendanceId: a.id,
          publishedAssignmentRevisionId:
            a.publishedAssignmentRevisionId ?? null,
          ...(a.scheduleRevisionId
            ? { scheduleRevisionId: a.scheduleRevisionId }
            : {}),
          ...(a.station ? { station: a.station } : {}),
          contractRevisionId: a.contractRevisionId,
          policyRevisionId: a.policyRevisionId,
          accountPolicyRevisionId: null,
          actorUserId: a.actorUserId,
          occurredAt: a.recordedAt,
          sourceEventIds: a.sourceEventIds,
          milliseconds: t.workedMs,
          breakMs: t.paidBreakMs + t.unpaidBreakMs,
          paidBreakMs: t.paidBreakMs,
          unpaidBreakMs: t.unpaidBreakMs,
          detail: a.state,
        });
        if (a.state !== "CLOSED" || !a.approval) unapprovedIds.push(a.id);
      }
    }
    if (a.approval) {
      const p = a.approval,
        t = workforceAttendanceWindowTotals(p.snapshot, range.start, range.end);
      if (t.presenceMs > 0) {
        approvedTotals.push(t);
        add({
          category: "APPROVED",
          date: Temporal.Instant.fromEpochMilliseconds(
            Math.max(Date.parse(p.snapshot.startsAt), range.start),
          )
            .toZonedDateTimeISO(input.timezone)
            .toPlainDate()
            .toString(),
          sourceId: p.id,
          sourceKind: "ATTENDANCE_APPROVAL",
          attendanceId: a.id,
          publishedAssignmentRevisionId:
            a.publishedAssignmentRevisionId ?? null,
          ...(a.scheduleRevisionId
            ? { scheduleRevisionId: a.scheduleRevisionId }
            : {}),
          ...(a.station ? { station: a.station } : {}),
          approvalId: p.id,
          contractRevisionId: p.contractRevisionId,
          policyRevisionId: p.policyRevisionId,
          accountPolicyRevisionId: null,
          actorUserId: p.actorUserId,
          occurredAt: p.createdAt,
          sourceEventIds: p.sourceEventIds,
          milliseconds: t.workedMs,
          breakMs: t.paidBreakMs + t.unpaidBreakMs,
          paidBreakMs: t.paidBreakMs,
          unpaidBreakMs: t.unpaidBreakMs,
          detail: "Manager-approved evidence",
        });
      }
    }
  }
  let creditedMs = 0;
  for (const target of targetDays) {
    const policy = input.policies.find(
      (p) => p.id === target.accountPolicyRevisionId,
    );
    const paid = input.leave
      .flatMap((l) =>
        l.status === "APPROVED"
          ? l.slices
              .filter((s) => s.date === target.date)
              .map((slice) => ({ l, slice }))
          : [],
      )
      .filter(({ l }) =>
        policy?.rules.paidLeaveCategories.includes(
          l.category as WorkforceAccountRules["paidLeaveCategories"][number],
        ),
      );
    const holiday = policy?.rules.holidays.find((h) => h.date === target.date);
    if (!policy || target.milliseconds === null) continue;
    const r = workforceDayRange(target.date, input.timezone);
    const approvedOnDay = workforceSumAttendanceTotals(
      input.attendance.flatMap((a) =>
        a.approval
          ? [
              workforceAttendanceWindowTotals(
                a.approval.snapshot,
                r.start,
                r.end,
              ),
            ]
          : [],
      ),
    ).workedMs;
    // Explicit LOST_TARGET allocation: paid leave/holiday never double-credit
    // worked target hours or each other. Holiday precedes paid leave on its date.
    let remaining = Math.max(0, target.milliseconds - approvedOnDay);
    if (
      holiday &&
      paid.some(
        ({ l, slice }) => l.category === "ANNUAL" && slice.chargedMinutes > 0,
      )
    )
      warnings.add("HOLIDAY_LEAVE_DEBIT_REQUIRES_REVIEW");
    if (holiday && remaining > 0) {
      add({
        category: "CREDITED",
        date: target.date,
        sourceId: policy.id + ":" + holiday.date,
        sourceKind: "CONFIRMED_HOLIDAY",
        contractRevisionId: target.contractRevisionId,
        policyRevisionId: null,
        accountPolicyRevisionId: policy.id,
        actorUserId: policy.createdByUserId,
        occurredAt: policy.createdAt,
        milliseconds: remaining,
        detail: holiday.label,
      });
      creditedMs += remaining;
      remaining = 0;
    }
    for (const { l, slice } of paid.sort((a, b) =>
      a.l.id.localeCompare(b.l.id),
    )) {
      const workedDuringLeave = workforceSumAttendanceTotals(
        input.attendance.flatMap((a) =>
          a.approval
            ? [
                workforceAttendanceWindowTotals(
                  a.approval.snapshot,
                  Date.parse(slice.startsAt),
                  Date.parse(slice.endsAt),
                ),
              ]
            : [],
        ),
      ).workedMs;
      const exactUnworked = Math.max(
        0,
        slice.chargedMinutes * 60000 - workedDuringLeave,
      );
      const ms = holiday
        ? 0
        : policy.rules.creditOverlapRule === "EXCLUDE_RECORDED_WORK"
          ? exactUnworked
          : Math.min(remaining, slice.chargedMinutes * 60000);
      remaining = Math.max(0, remaining - ms);
      creditedMs += ms;
      add({
        category: "CREDITED",
        date: target.date,
        sourceId: l.id,
        sourceKind: "APPROVED_LEAVE",
        leaveDecisionId: l.decisionId,
        contractRevisionId: slice.contractRevisionId,
        policyRevisionId: slice.policyRevisionId,
        accountPolicyRevisionId: policy.id,
        actorUserId: l.actorUserId,
        occurredAt: l.occurredAt,
        milliseconds: ms,
        detail: l.category,
      });
    }
  }
  const actual = workforceSumAttendanceTotals(actualTotals),
    approved = workforceSumAttendanceTotals(approvedTotals);
  const targetMs = targetDays.some((t) => t.milliseconds === null)
    ? null
    : Math.round(targetDays.reduce((n, t) => n + t.milliseconds!, 0));
  const periodContract = workforceContractAt(input.contracts, range.to);
  const policy = periodContract
    ? workforceAccountPolicyAt(
        input.policies,
        range.to,
        periodContract.countryCode,
      )
    : null;
  if (input.carryMs === null) warnings.add("CARRY_UNCONFIGURED");
  if (unapprovedIds.length) warnings.add("UNAPPROVED_ATTENDANCE");
  if (input.pendingRequestIds.length) warnings.add("PENDING_REQUESTS");
  const plannedMs = Math.round(
    entries
      .filter((e) => e.category === "PLANNED")
      .reduce((n, e) => n + e.milliseconds, 0),
  );
  creditedMs = Math.round(creditedMs);
  const creditedValue =
    warnings.has("ACCOUNT_POLICY_UNCONFIGURED") ||
    warnings.has("CONTRACT_UNCONFIGURED") ||
    warnings.has("TARGET_UNCONFIGURED")
      ? null
      : creditedMs;
  const plannedValue = warnings.has("PLANNED_BREAK_RULE_UNCONFIGURED")
    ? null
    : plannedMs;
  const balanceMs =
    targetMs === null || input.carryMs === null || creditedValue === null
      ? null
      : approved.workedMs + creditedMs - targetMs + input.carryMs;
  const overtimeMs =
    targetMs === null || !policy || policy.rules.overtimeBasis === "DISABLED"
      ? null
      : Math.max(
          0,
          approved.workedMs +
            (policy.rules.overtimeBasis === "EARNED_OVER_TARGET"
              ? creditedMs
              : 0) -
            targetMs,
        );
  const absences = input.leave
    .flatMap((leave) =>
      leave.slices
        .filter((slice) => slice.date.startsWith(input.month))
        .map((slice) => ({
          requestId: leave.id,
          decisionId: leave.decisionId,
          date: slice.date,
          category: leave.category,
          status: leave.status,
          chargedMinutes: slice.chargedMinutes,
          contractRevisionId: slice.contractRevisionId,
          policyRevisionId: slice.policyRevisionId,
          actorUserId: leave.actorUserId,
          occurredAt: leave.occurredAt,
          creditedMs: entries
            .filter(
              (e) =>
                e.category === "CREDITED" &&
                e.sourceId === leave.id &&
                e.date === slice.date,
            )
            .reduce((n, e) => n + e.milliseconds, 0),
        })),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.requestId.localeCompare(b.requestId),
    );
  return {
    schemaVersion: 1 as const,
    month: input.month,
    timezone: input.timezone,
    range,
    targetDays,
    absences,
    entries: entries.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.category.localeCompare(b.category) ||
        a.sourceId.localeCompare(b.sourceId),
    ),
    totals: {
      plannedMs: plannedValue,
      actualMs: actual.workedMs,
      approvedMs: approved.workedMs,
      creditedMs: creditedValue,
      targetMs,
      carryMs: input.carryMs,
      balanceMs,
      overtimeMs,
      actualPresenceMs: actual.presenceMs,
      actualPaidBreakMs: actual.paidBreakMs,
      actualUnpaidBreakMs: actual.unpaidBreakMs,
      approvedPaidBreakMs: approved.paidBreakMs,
      approvedUnpaidBreakMs: approved.unpaidBreakMs,
    },
    unapprovedAttendanceIds: [...new Set(unapprovedIds)],
    pendingRequestIds: input.pendingRequestIds,
    carrySourceIds: input.carrySourceIds,
    warnings: [...warnings].sort(),
    accountPolicyIds: [
      ...new Set(
        [
          ...targetDays,
          ...(policy ? [{ accountPolicyRevisionId: policy.id }] : []),
        ].flatMap((t) =>
          t.accountPolicyRevisionId ? [t.accountPolicyRevisionId] : [],
        ),
      ),
    ],
  };
}
export type WorkforceMonthlyAccount = ReturnType<
  typeof workforceMonthlyAccount
>;
export function assertWorkforceMonthlyClose(
  account: WorkforceMonthlyAccount,
  now: Date,
  confirmed: boolean,
) {
  if (!confirmed)
    throw new WorkforceError(
      "APPROVAL",
      "Review and confirm this complete monthly statement.",
    );
  if (now.getTime() < account.range.end)
    throw new WorkforceError(
      "TIME",
      "The month must have ended before closing.",
    );
  if (account.warnings.length || account.totals.balanceMs === null)
    throw new WorkforceError(
      "CONFLICT",
      "Resolve missing configuration, pending requests and unapproved attendance before closing.",
      "MONTH_NOT_READY",
    );
}
export function workforceCsvCell(value: string | number | null) {
  if (value === null) return '""';
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new WorkforceError("INVALID", "Invalid report number.");
    return String(value);
  }
  const text =
    /^[\s\u0000-\u001f\uFEFF]*[=+\-@]/.test(value) || /[\t\r]/.test(value)
      ? "'" + value
      : value;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function workforceAccountPreviousMonth(month: string) {
  workforceMonthSchema.parse(month);
  return Temporal.PlainYearMonth.from(month).subtract({ months: 1 }).toString();
}
export function workforceAccountRetentionUntil(
  now: Date,
  timezone: string,
  years: number,
) {
  if (!Number.isInteger(years) || years < 1 || years > 30)
    throw new WorkforceError("INVALID", "Confirm retention years.");
  return new Date(
    Temporal.Instant.fromEpochMilliseconds(now.getTime())
      .toZonedDateTimeISO(timezone)
      .add({ years }).epochMilliseconds,
  ).toISOString();
}

export function workforceMonthlyCloseEligible(
  account: WorkforceMonthlyAccount,
  now: Date,
) {
  try {
    assertWorkforceMonthlyClose(account, now, true);
    return true;
  } catch (e) {
    if (e instanceof WorkforceError) return false;
    throw e;
  }
}
