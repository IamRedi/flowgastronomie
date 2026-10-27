import { describe, expect, it } from "vitest";

import {
  assertNoOverlappingScheduleAssignments,
  assertValidScheduleAssignment,
  InvalidScheduleAssignmentError,
  scheduleAssignmentsOverlap,
} from "../src/staff-schedule";

const startsAt = new Date("2026-08-10T08:00:00.000Z");
const endsAt = new Date("2026-08-10T16:00:00.000Z");

describe("staff schedule", () => {
  it("accepts adjacent assignments and rejects overlapping work", () => {
    expect(
      scheduleAssignmentsOverlap(
        { startsAt, endsAt },
        { startsAt: endsAt, endsAt: new Date("2026-08-10T20:00:00.000Z") },
      ),
    ).toBe(false);
    expect(() =>
      assertNoOverlappingScheduleAssignments([
        { membershipId: "member-1", role: "WAITER", startsAt, endsAt },
        {
          membershipId: "member-1",
          role: "WAITER",
          startsAt: new Date("2026-08-10T15:00:00.000Z"),
          endsAt: new Date("2026-08-10T20:00:00.000Z"),
        },
      ]),
    ).toThrow(InvalidScheduleAssignmentError);
  });

  it("rejects a missing member and an invalid time range", () => {
    expect(() =>
      assertValidScheduleAssignment({
        membershipId: "",
        role: "WAITER",
        startsAt,
        endsAt,
      }),
    ).toThrow(InvalidScheduleAssignmentError);
    expect(() =>
      assertValidScheduleAssignment({
        membershipId: "member-1",
        role: "WAITER",
        startsAt: endsAt,
        endsAt: startsAt,
      }),
    ).toThrow(InvalidScheduleAssignmentError);
  });
});
