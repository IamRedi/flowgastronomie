import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import {
  hasStaffPermission,
  StaffPermissionDeniedError,
  type StaffRole,
} from "./staff-permissions";

export class WorkforceError extends Error {
  constructor(
    public code:
      "INVALID" | "TIME" | "CONFLICT" | "NOT_FOUND" | "PAST" | "APPROVAL",
    message: string,
    public detail?: string,
  ) {
    super(message);
    this.name = "WorkforceError";
  }
}
export const workforceDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    try {
      Temporal.PlainDate.from(v);
      return true;
    } catch {
      return false;
    }
  });
export const workforceLocalSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
export const workforceStationSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[\p{L}\p{N} _-]+$/u);
export const workforceAvailabilitySchema = z
  .array(
    z
      .object({
        day: z.number().int().min(1).max(7),
        startMinute: z.number().int().min(0).max(1439),
        endMinute: z.number().int().min(1).max(1440),
      })
      .strict()
      .refine((v) => v.endMinute > v.startMinute),
  )
  .max(21);
export const workforceProfileSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    displayName: z.string().trim().min(1).max(120).optional(),
    workPhone: z.string().trim().max(40).nullable().optional(),
    employeeRef: z.string().trim().max(80).nullable().optional(),
    jobTitle: z.string().trim().max(80).optional(),
    employmentStartedOn: workforceDateSchema.nullable().optional(),
    employmentEndedOn: workforceDateSchema.nullable().optional(),
    employmentStatus: z.enum(["ACTIVE", "ONBOARDING", "ENDED"]).optional(),
    stations: z.array(workforceStationSchema).max(20).optional(),
    skills: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    recurringAvailability: workforceAvailabilitySchema.optional(),
    annualLeaveDays: z.number().int().min(0).max(366).optional(),
  })
  .strict();
export const workforceContractSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    effectiveFrom: workforceDateSchema,
    employmentType: z.enum([
      "FULL_TIME",
      "PART_TIME",
      "MINIJOB",
      "TEMPORARY",
      "OTHER",
    ]),
    weeklyTargetMinutes: z.number().int().min(0).max(10080),
    monthlyTargetMinutes: z.number().int().min(0).max(44640).nullable(),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    terms: z.string().trim().max(4000),
  })
  .strict();
export const workforceAssignmentSchema = z
  .object({
    id: z.string().min(1).max(128),
    membershipId: z.string().min(1).max(128).nullable(),
    station: workforceStationSchema,
    startsLocal: workforceLocalSchema,
    endsLocal: workforceLocalSchema,
    startChoice: z.enum(["reject", "earlier", "later"]).default("reject"),
    endChoice: z.enum(["reject", "earlier", "later"]).default("reject"),
    breakMinutes: z.number().int().min(0).max(480).default(0),
    requiredSkills: z
      .array(z.string().trim().min(1).max(80))
      .max(20)
      .default([]),
    note: z.string().trim().max(500).default(""),
  })
  .strict();
export const workforceScheduleSchema = z
  .object({
    week: workforceDateSchema,
    expectedVersion: z.number().int().min(0),
    status: z.enum(["DRAFT", "PUBLISHED"]),
    reviewConfirmed: z.boolean().default(false),
    assignments: z.array(workforceAssignmentSchema).max(500),
  })
  .strict();
export const workforceTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    station: workforceStationSchema,
    startMinute: z.number().int().min(0).max(1439),
    durationMinutes: z.number().int().min(15).max(1440),
    breakMinutes: z.number().int().min(0).max(480),
    requiredSkills: z.array(z.string().trim().min(1).max(80)).max(20),
  })
  .strict()
  .refine(
    (v) =>
      v.startMinute % 15 === 0 &&
      v.durationMinutes % 15 === 0 &&
      v.breakMinutes < v.durationMinutes,
  );
export type WorkforceAssignment = z.infer<typeof workforceAssignmentSchema>;
export type WorkforceScheduleInput = z.infer<typeof workforceScheduleSchema>;
export type WorkforceInstantAssignment = WorkforceAssignment & {
  userId: string | null;
  role: StaffRole;
  startsAt: string;
  endsAt: string;
  displayName: string;
};
export type WorkforceSnapshot = {
  week: string;
  timezone: string;
  venueId: string;
  venueName: string;
  assignments: WorkforceInstantAssignment[];
};
export function workforceToday(timezone: string, now = new Date()) {
  return Temporal.Instant.from(now.toISOString())
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
    .toString();
}
export function workforceWeek(date: string) {
  const d = Temporal.PlainDate.from(date);
  return d.subtract({ days: d.dayOfWeek - 1 }).toString();
}
export function workforceAddDays(date: string, days: number) {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}
export function workforceLocal(instant: string, timezone: string) {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timezone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
}
export function workforceInstant(
  local: string,
  timezone: string,
  choice: "reject" | "earlier" | "later" = "reject",
) {
  try {
    const value = Temporal.PlainDateTime.from(local);
    if (value.minute % 15 !== 0 || value.second !== 0)
      throw new WorkforceError("TIME", "Use 15-minute increments.");
    try {
      return new Date(
        value.toZonedDateTime(timezone, { disambiguation: "reject" })
          .epochMilliseconds,
      ).toISOString();
    } catch {
      const early = value.toZonedDateTime(timezone, {
        disambiguation: "earlier",
      });
      const late = value.toZonedDateTime(timezone, { disambiguation: "later" });
      if (
        !early.toPlainDateTime().equals(value) ||
        !late.toPlainDateTime().equals(value)
      )
        throw new WorkforceError(
          "TIME",
          "This local time does not exist because of DST.",
        );
      if (choice === "reject")
        throw new WorkforceError(
          "TIME",
          "This local time occurs twice. Choose the earlier or later offset explicitly.",
        );
      return new Date(
        (choice === "earlier" ? early : late).epochMilliseconds,
      ).toISOString();
    }
  } catch (error) {
    if (error instanceof WorkforceError) throw error;
    throw new WorkforceError("TIME", "Check the date and IANA timezone.");
  }
}
export function workforceMove(
  a: WorkforceAssignment,
  day: string,
  membershipId: string | null,
): WorkforceAssignment {
  const start = Temporal.PlainDateTime.from(a.startsLocal),
    end = Temporal.PlainDateTime.from(a.endsLocal);
  const delta = Temporal.PlainDate.from(day).since(start.toPlainDate()).days;
  return {
    ...a,
    membershipId,
    startsLocal: start
      .add({ days: delta })
      .toString({ smallestUnit: "minute" }),
    endsLocal: end.add({ days: delta }).toString({ smallestUnit: "minute" }),
  };
}
export function workforceResize(
  a: WorkforceAssignment,
  deltaMinutes: number,
): WorkforceAssignment {
  return {
    ...a,
    endsLocal: Temporal.PlainDateTime.from(a.endsLocal)
      .add({ minutes: Math.round(deltaMinutes / 15) * 15 })
      .toString({ smallestUnit: "minute" }),
  };
}
export function workforcePlannedMinutes(
  a: Pick<WorkforceInstantAssignment, "startsAt" | "endsAt" | "breakMinutes">,
) {
  return (
    (Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60000 - a.breakMinutes
  );
}
export function workforceDiff(
  before: WorkforceInstantAssignment[],
  after: WorkforceInstantAssignment[],
) {
  const left = new Map(before.map((x) => [x.id, x])),
    right = new Map(after.map((x) => [x.id, x]));
  return [...new Set([...left.keys(), ...right.keys()])].flatMap((id) => {
    const a = left.get(id),
      b = right.get(id);
    const canonical = (v: WorkforceInstantAssignment | undefined) =>
      v
        ? JSON.stringify([
            v.id,
            v.membershipId,
            v.userId,
            v.role,
            v.displayName,
            v.station,
            v.startsLocal,
            v.endsLocal,
            v.startChoice,
            v.endChoice,
            v.breakMinutes,
            [...v.requiredSkills].sort(),
            v.note,
            v.startsAt,
            v.endsAt,
          ])
        : null;
    if (canonical(a) === canonical(b)) return [];
    return [
      {
        id,
        kind: !a ? "ADDED" : !b ? "REMOVED" : "CHANGED",
        before: a ?? null,
        after: b ?? null,
      },
    ];
  });
}
export function assertWorkforceSchedule(
  input: WorkforceScheduleInput,
  resolved: WorkforceInstantAssignment[],
  before: WorkforceInstantAssignment[],
  today: string,
) {
  if (workforceWeek(input.week) !== input.week)
    throw new WorkforceError(
      "INVALID",
      "Choose the Monday of the venue-local week.",
    );
  if (new Set(resolved.map((a) => a.id)).size !== resolved.length)
    throw new WorkforceError("INVALID", "Assignment IDs must be unique.");
  for (const a of resolved) {
    const duration = (Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60000;
    if (duration <= 0 || duration > 1440 || a.breakMinutes >= duration)
      throw new WorkforceError(
        "INVALID",
        "A shift must last 15 minutes to 24 hours, with a shorter break.",
      );
    if (workforceWeek(a.startsLocal.slice(0, 10)) !== input.week)
      throw new WorkforceError(
        "INVALID",
        "A shift must start inside its schedule week.",
      );
  }
  for (const change of workforceDiff(before, resolved))
    if (
      (change.before?.startsLocal.slice(0, 10) ??
        change.after!.startsLocal.slice(0, 10)) < today
    )
      throw new WorkforceError(
        "PAST",
        "Past assignments are preserved; use the later correction ledger when available.",
      );
  for (let i = 0; i < resolved.length; i++)
    for (const b of resolved.slice(i + 1)) {
      const a = resolved[i]!;
      if (
        a.userId &&
        a.userId === b.userId &&
        a.startsAt < b.endsAt &&
        b.startsAt < a.endsAt
      )
        throw new WorkforceError(
          "CONFLICT",
          "A staff member has overlapping shifts.",
        );
    }
  if (input.status === "PUBLISHED" && !input.reviewConfirmed)
    throw new WorkforceError(
      "APPROVAL",
      "Review and confirm the changes before publishing.",
    );
}
export function assertWorkforceProfileWrite(
  role: StaffRole,
  self: boolean,
  fields: string[],
) {
  if (role === "OWNER") return;
  if (fields.includes("annualLeaveDays"))
    throw new StaffPermissionDeniedError(role, "WORKFORCE_PRIVATE_MANAGE");
  if (hasStaffPermission(role, "SCHEDULE_MANAGE")) return;
  if (
    !self ||
    fields.some(
      (f) =>
        ![
          "expectedVersion",
          "displayName",
          "workPhone",
          "recurringAvailability",
        ].includes(f),
    )
  )
    throw new StaffPermissionDeniedError(role, "SCHEDULE_MANAGE");
}
export function assertWorkforceContractDate(
  from: string,
  today: string,
  hasHistory: boolean,
) {
  if (hasHistory && from < today)
    throw new WorkforceError(
      "PAST",
      "New contract changes cannot rewrite a past period.",
    );
}
export function workforceContractAt<
  T extends { effectiveFrom: string; version: number },
>(records: T[], date: string): T | null {
  return (
    [...records]
      .filter((r) => r.effectiveFrom <= date)
      .sort(
        (a, b) =>
          b.effectiveFrom.localeCompare(a.effectiveFrom) ||
          b.version - a.version,
      )[0] ?? null
  );
}
export function workforceWarnings(
  assignments: WorkforceInstantAssignment[],
  profiles: {
    membershipId: string;
    skills: string[];
    stations: string[];
    recurringAvailability: {
      day: number;
      startMinute: number;
      endMinute: number;
    }[];
  }[],
  unavailable: { membershipId: string; startsAt: string; endsAt: string }[],
) {
  const warnings: { assignmentId: string; code: string }[] = [];
  for (const a of assignments) {
    if (!a.membershipId) {
      warnings.push({ assignmentId: a.id, code: "OPEN_SHIFT" });
      continue;
    }
    const p = profiles.find((x) => x.membershipId === a.membershipId);
    if (a.requiredSkills.some((s) => !p?.skills.includes(s)))
      warnings.push({ assignmentId: a.id, code: "QUALIFICATION" });
    if (p?.stations.length && !p.stations.includes(a.station))
      warnings.push({ assignmentId: a.id, code: "STATION" });
    if (
      unavailable.some(
        (n) =>
          n.membershipId === a.membershipId &&
          n.startsAt < a.endsAt &&
          a.startsAt < n.endsAt,
      )
    )
      warnings.push({ assignmentId: a.id, code: "UNAVAILABILITY" });
    if (p?.recurringAvailability.length) {
      const d = Temporal.PlainDateTime.from(a.startsLocal),
        e = Temporal.PlainDateTime.from(a.endsLocal);
      const startDate = d.toPlainDate(),
        endDate = e.toPlainDate();
      let covered = true;
      for (
        let day = startDate;
        Temporal.PlainDate.compare(day, endDate) <= 0;
        day = day.add({ days: 1 })
      ) {
        const start = day.equals(startDate) ? d.hour * 60 + d.minute : 0,
          end = day.equals(endDate) ? e.hour * 60 + e.minute : 1440;
        if (
          end > start &&
          !p.recurringAvailability.some(
            (w) =>
              w.day === day.dayOfWeek &&
              w.startMinute <= start &&
              w.endMinute >= end,
          )
        )
          covered = false;
      }
      if (!covered) warnings.push({ assignmentId: a.id, code: "AVAILABILITY" });
    }
  }
  return warnings;
}
export type WorkforcePublishedEvent = {
  schemaVersion: 1;
  eventId: string;
  type: "SCHEDULE_PUBLISHED" | "SCHEDULE_REPUBLISHED";
  tenantId: string;
  venueId: string;
  scheduleId: string;
  version: number;
  actorUserId: string;
  occurredAt: string;
  recipientUserIds: string[];
  changes: {
    id: string;
    kind: string;
    before: {
      userId: string | null;
      station: string;
      startsAt: string;
      endsAt: string;
      breakMinutes: number;
    } | null;
    after: {
      userId: string | null;
      station: string;
      startsAt: string;
      endsAt: string;
      breakMinutes: number;
    } | null;
  }[];
};
export function workforcePublicationEvent(
  scope: Omit<
    WorkforcePublishedEvent,
    "schemaVersion" | "recipientUserIds" | "changes"
  >,
  before: WorkforceInstantAssignment[],
  after: WorkforceInstantAssignment[],
): WorkforcePublishedEvent {
  const changes = workforceDiff(before, after);
  const minimal = (a: WorkforceInstantAssignment | null) =>
    a
      ? {
          userId: a.userId,
          station: a.station,
          startsAt: a.startsAt,
          endsAt: a.endsAt,
          breakMinutes: a.breakMinutes,
        }
      : null;
  return {
    ...scope,
    schemaVersion: 1,
    changes: changes.map((c) => ({
      id: c.id,
      kind: c.kind,
      before: minimal(c.before),
      after: minimal(c.after),
    })),
    recipientUserIds: [
      ...new Set(
        changes.flatMap((c) =>
          [c.before?.userId, c.after?.userId].filter((v): v is string => !!v),
        ),
      ),
    ],
  };
}

export function workforceMonthDays(date: string) {
  const first = Temporal.PlainDate.from(date).with({ day: 1 });
  return Array.from({ length: first.daysInMonth }, (_, i) =>
    first.add({ days: i }).toString(),
  );
}
export function workforceMonthShift(date: string, delta: number) {
  return Temporal.PlainDate.from(date)
    .with({ day: 1 })
    .add({ months: delta })
    .toString();
}
export function workforceDayRange(date: string, timezone: string) {
  const start = Temporal.PlainDate.from(date).toZonedDateTime({
    timeZone: timezone,
    plainTime: "00:00",
  });
  const end = start.add({ days: 1 });
  return { start: start.epochMilliseconds, end: end.epochMilliseconds };
}

export const workforceMoveSchema = z
  .object({
    sourceWeek: workforceDateSchema,
    sourceVersion: z.number().int().min(0),
    targetVersion: z.number().int().min(0),
    assignment: workforceAssignmentSchema,
  })
  .strict();

// WF2/WF3 contracts reference the existing identities and frozen WF1 publications.
export type WorkforceAttendanceEventV1 = {
  schemaVersion: 1;
  id: string;
  tenantId: string;
  venueId: string;
  userId: string;
  membershipId: string;
  publishedAssignmentRevisionId: string | null;
  operationalStaffShiftId: string | null;
  kind: "CLOCK_IN" | "BREAK_START" | "BREAK_END" | "CLOCK_OUT" | "CORRECTION";
  occurredAt: string;
  recordedAt: string;
  actorUserId: string;
  idempotencyKey: string;
  correctsEventId: string | null;
};
export type WorkforceMonthlySnapshotV1 = {
  schemaVersion: 1;
  tenantId: string;
  venueId: string;
  userId: string;
  month: string;
  timezone: string;
  employmentCountry: string;
  contractRevisionIds: string[];
  policyRevisionId: string;
  targetMinutes: number;
  approvedWorkedMinutes: number;
  creditedVacationMinutes: number;
  creditedHolidayMinutes: number;
  unpaidAbsenceMinutes: number;
  carryMinutes: number;
  closingBalanceMinutes: number;
  version: number;
  closedAt: string | null;
  closedByUserId: string | null;
};
export type WorkforceNotificationIntentV1 = {
  schemaVersion: 1;
  publicationEventId: string;
  tenantId: string;
  venueId: string;
  recipientUserId: string;
  locale: "sq" | "de" | "en" | "it";
  channel: "IN_APP" | "EMAIL" | "WEB_PUSH";
  deduplicationKey: string;
};
