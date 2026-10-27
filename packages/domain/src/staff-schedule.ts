import type { StaffRole } from "./staff-permissions";

export const SCHEDULE_STATUSES = ["DRAFT", "PUBLISHED"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export type ScheduleAssignmentInput = {
  membershipId: string;
  role: StaffRole;
  startsAt: Date;
  endsAt: Date;
};

export class InvalidScheduleAssignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidScheduleAssignmentError";
  }
}

export function assertValidScheduleAssignment(
  assignment: ScheduleAssignmentInput,
): void {
  if (
    !assignment.membershipId ||
    Number.isNaN(assignment.startsAt.getTime()) ||
    Number.isNaN(assignment.endsAt.getTime()) ||
    assignment.endsAt <= assignment.startsAt
  ) {
    throw new InvalidScheduleAssignmentError(
      "A schedule assignment needs a member and a valid time range",
    );
  }
}

export function scheduleAssignmentsOverlap(
  left: Pick<ScheduleAssignmentInput, "startsAt" | "endsAt">,
  right: Pick<ScheduleAssignmentInput, "startsAt" | "endsAt">,
): boolean {
  return left.startsAt < right.endsAt && right.startsAt < left.endsAt;
}

export function assertNoOverlappingScheduleAssignments(
  assignments: ScheduleAssignmentInput[],
): void {
  for (const assignment of assignments)
    assertValidScheduleAssignment(assignment);
  for (let index = 0; index < assignments.length; index += 1) {
    for (let other = index + 1; other < assignments.length; other += 1) {
      if (
        assignments[index]!.membershipId === assignments[other]!.membershipId &&
        scheduleAssignmentsOverlap(assignments[index]!, assignments[other]!)
      ) {
        throw new InvalidScheduleAssignmentError(
          "A staff member cannot have overlapping scheduled assignments",
        );
      }
    }
  }
}
