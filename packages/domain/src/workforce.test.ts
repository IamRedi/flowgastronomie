import { describe, expect, it } from "vitest";
import {
  workforceInstant,
  workforceLocal,
  workforceWeek,
  workforceMove,
  workforceResize,
  workforceContractAt,
  assertWorkforceContractDate,
  workforceScheduleSchema,
  workforceProfileSchema,
  assertWorkforceProfileWrite,
  assertWorkforceSchedule,
  workforcePublicationEvent,
  workforcePlannedMinutes,
  workforceWarnings,
  workforceDayRange,
  workforceDiff,
  type WorkforceAssignment,
  type WorkforceInstantAssignment,
} from "./workforce";
const row: WorkforceAssignment = {
  id: "shift-1",
  membershipId: "member-1",
  station: "KITCHEN",
  startsLocal: "2030-08-12T18:00",
  endsLocal: "2030-08-13T02:00",
  startChoice: "reject",
  endChoice: "reject",
  breakMinutes: 30,
  requiredSkills: ["Food safety"],
  note: "Operational only",
};
const resolved: WorkforceInstantAssignment = {
  ...row,
  userId: "user-1",
  role: "WAITER",
  displayName: "Worker",
  startsAt: workforceInstant(row.startsLocal, "Europe/Berlin"),
  endsAt: workforceInstant(row.endsLocal, "Europe/Berlin"),
};
const input = () =>
  workforceScheduleSchema.parse({
    week: "2030-08-12",
    expectedVersion: 0,
    status: "DRAFT",
    assignments: [row],
  });
describe("workforce domain", () => {
  for (const timezone of ["Europe/Berlin", "Europe/Tirane"]) {
    it(`${timezone}: rejects DST gaps and requires explicit fold choice`, () => {
      expect(() => workforceInstant("2026-03-29T02:30", timezone)).toThrow(
        "does not exist",
      );
      expect(() =>
        workforceInstant("2026-03-29T02:30", timezone, "later"),
      ).toThrow("does not exist");
      expect(() => workforceInstant("2026-10-25T02:30", timezone)).toThrow(
        "occurs twice",
      );
      expect(
        Date.parse(workforceInstant("2026-10-25T02:30", timezone, "later")) -
          Date.parse(workforceInstant("2026-10-25T02:30", timezone, "earlier")),
      ).toBe(3600000);
      const gap = workforceDayRange("2026-03-29", timezone),
        fold = workforceDayRange("2026-10-25", timezone);
      expect((gap.end - gap.start) / 3600000).toBe(23);
      expect((fold.end - fold.start) / 3600000).toBe(25);
    });
  }
  it("preserves venue-local dates across midnight, week moves and quarter-hour resize", () => {
    expect(workforceLocal(resolved.startsAt, "Europe/Berlin")).toBe(
      row.startsLocal,
    );
    expect(workforceWeek("2030-08-18")).toBe("2030-08-12");
    expect(workforceMove(row, "2030-08-13", "member-2")).toMatchObject({
      id: row.id,
      membershipId: "member-2",
      startsLocal: "2030-08-13T18:00",
      endsLocal: "2030-08-14T02:00",
    });
    expect(workforceResize(row, 17).endsLocal).toBe("2030-08-13T02:15");
    expect(workforcePlannedMinutes(resolved)).toBe(450);
    expect(() => workforceInstant("2030-08-12T18:07", "Europe/Berlin")).toThrow(
      "15-minute",
    );
  });
  it("enforces publication approval, stable unique IDs and overlap rules", () => {
    expect(() =>
      assertWorkforceSchedule(input(), [resolved], [], "2030-08-12"),
    ).not.toThrow();
    expect(() =>
      assertWorkforceSchedule(
        { ...input(), status: "PUBLISHED" },
        [resolved],
        [],
        "2030-08-12",
      ),
    ).toThrow("confirm");
    expect(() =>
      assertWorkforceSchedule(
        input(),
        [resolved, { ...resolved }],
        [],
        "2030-08-12",
      ),
    ).toThrow("unique");
    expect(() =>
      assertWorkforceSchedule(
        input(),
        [resolved, { ...resolved, id: "shift-2" }],
        [],
        "2030-08-12",
      ),
    ).toThrow("overlapping");
    expect(() =>
      assertWorkforceSchedule(
        input(),
        [
          resolved,
          { ...resolved, id: "open", membershipId: null, userId: null },
        ],
        [],
        "2030-08-12",
      ),
    ).not.toThrow();
  });
  it("compares assignment values independently of JSON property order", () => {
    const reordered = Object.fromEntries(
      Object.entries(resolved).reverse(),
    ) as WorkforceInstantAssignment;
    expect(workforceDiff([resolved], [reordered])).toEqual([]);
    expect(() =>
      assertWorkforceSchedule(input(), [reordered], [resolved], "2030-08-20"),
    ).not.toThrow();
  });
  it("preserves unchanged past work and blocks editing/removing/adding past work", () => {
    expect(() =>
      assertWorkforceSchedule(input(), [resolved], [resolved], "2030-08-20"),
    ).not.toThrow();
    expect(() =>
      assertWorkforceSchedule(input(), [], [resolved], "2030-08-20"),
    ).toThrow("Past");
    expect(() =>
      assertWorkforceSchedule(
        input(),
        [{ ...resolved, note: "changed" }],
        [resolved],
        "2030-08-20",
      ),
    ).toThrow("Past");
    expect(() =>
      assertWorkforceSchedule(input(), [resolved], [], "2030-08-20"),
    ).toThrow("Past");
  });
  it("separates HR permissions and forbids collecting medical/bank fields", () => {
    expect(() =>
      assertWorkforceProfileWrite("WAITER", true, [
        "expectedVersion",
        "workPhone",
        "displayName",
      ]),
    ).not.toThrow();
    expect(() =>
      assertWorkforceProfileWrite("WAITER", false, ["workPhone"]),
    ).toThrow();
    expect(() =>
      assertWorkforceProfileWrite("WAITER", true, ["skills"]),
    ).toThrow();
    expect(() =>
      assertWorkforceProfileWrite("MANAGER", false, ["annualLeaveDays"]),
    ).toThrow();
    expect(() =>
      assertWorkforceProfileWrite("OWNER", false, ["annualLeaveDays"]),
    ).not.toThrow();
    expect(
      workforceProfileSchema.safeParse({
        expectedVersion: 0,
        medicalDiagnosis: "anything",
      }).success,
    ).toBe(false);
    expect(
      workforceProfileSchema.safeParse({
        expectedVersion: 0,
        bankAccount: "anything",
      }).success,
    ).toBe(false);
  });
  it("selects effective contract versions without rewriting past periods", () => {
    const old = {
        version: 1,
        effectiveFrom: "2026-01-01",
        weeklyTargetMinutes: 1200,
      },
      current = {
        version: 2,
        effectiveFrom: "2026-10-09",
        weeklyTargetMinutes: 1800,
      };
    expect(workforceContractAt([current, old], "2026-09-01")).toEqual(old);
    expect(workforceContractAt([old, current], "2026-10-09")).toEqual(current);
    expect(() =>
      assertWorkforceContractDate("2026-09-01", "2026-10-09", true),
    ).toThrow("past period");
    expect(() =>
      assertWorkforceContractDate("2026-01-01", "2026-10-09", false),
    ).not.toThrow();
  });
  it("records qualification, station, recurring availability and unavailability warnings", () => {
    const warnings = workforceWarnings(
      [resolved],
      [
        {
          membershipId: "member-1",
          skills: [],
          stations: ["BAR"],
          recurringAvailability: [
            { day: 1, startMinute: 480, endMinute: 1020 },
          ],
        },
      ],
      [
        {
          membershipId: "member-1",
          startsAt: resolved.startsAt,
          endsAt: resolved.endsAt,
        },
      ],
    );
    expect(warnings.map((w) => w.code)).toEqual([
      "QUALIFICATION",
      "STATION",
      "UNAVAILABILITY",
      "AVAILABILITY",
    ]);
  });
  it("recognizes availability windows split across midnight", () => {
    expect(
      workforceWarnings(
        [resolved],
        [
          {
            membershipId: "member-1",
            skills: ["Food safety"],
            stations: ["KITCHEN"],
            recurringAvailability: [
              { day: 1, startMinute: 1080, endMinute: 1440 },
              { day: 2, startMinute: 0, endMinute: 120 },
            ],
          },
        ],
        [],
      ),
    ).toEqual([]);
  });
  it("targets only affected people on republish and excludes free text/HR in notification contract", () => {
    const event = workforcePublicationEvent(
      {
        eventId: "schedule:2",
        type: "SCHEDULE_REPUBLISHED",
        tenantId: "t",
        venueId: "v",
        scheduleId: "s",
        version: 2,
        actorUserId: "owner",
        occurredAt: "2026-10-09T00:00:00Z",
      },
      [resolved],
      [{ ...resolved, userId: "user-2", membershipId: "member-2" }],
    );
    expect(event.recipientUserIds.sort()).toEqual(["user-1", "user-2"]);
    expect(event.changes).toHaveLength(1);
    expect(JSON.stringify(event)).not.toContain("Operational only");
    expect(JSON.stringify(event)).not.toContain("Food safety");
    expect(
      workforcePublicationEvent({ ...event }, [resolved], [resolved])
        .recipientUserIds,
    ).toEqual([]);
  });
});
