import { describe, it, expect } from "vitest";
import {
  assertWorkforceLeaveAllowance,
  assertWorkforcePolicyDate,
  assertWorkforceCorrectionPeriod,
  workforceRequestActions,
  workforceAttendanceTotals,
  workforceAttendanceState,
  workforceOriginalAttendance,
  assertAttendanceTransition,
  workforceAttendanceWarnings,
  workforceDefaultRules,
  workforceRecordedInstant,
  workforceLeaveSlices,
  workforceRequestTransition,
  assertIndependentWorkforceReview,
  workforcePunchSchema,
  workforceLeaveSchema,
  workforceCorrectionSnapshot,
  workforceCorrectionSchema,
  workforceShiftRestWarnings,
  workforceAttendanceWindowTotals,
  workforceSumAttendanceTotals,
  type AttendanceEvidence,
} from "./workforce-operations";
const snapshot = {
  startsAt: "2030-08-12T07:00:00.000Z",
  endsAt: "2030-08-12T15:00:00.000Z",
  breaks: [
    {
      startsAt: "2030-08-12T11:00:00.000Z",
      endsAt: "2030-08-12T11:30:00.000Z",
      kind: "UNPAID" as const,
    },
  ],
};
const e = (
  kind: AttendanceEvidence["kind"],
  sequence: number,
  occurredAt: string,
  payload: AttendanceEvidence["payload"] = {},
): AttendanceEvidence => ({
  id: "e" + sequence,
  kind,
  sequence,
  occurredAt,
  payload,
});
describe("WF2 actual and approved working-time rules", () => {
  it("reconciles eight hours presence, thirty unpaid break and 450 worked minutes", () => {
    expect(workforceAttendanceTotals(snapshot)).toMatchObject({
      presenceMinutes: 480,
      breakMinutes: 30,
      unpaidBreakMinutes: 30,
      paidBreakMinutes: 0,
      workedMinutes: 450,
      workedMs: 27000000,
    });
  });
  it("keeps paid breaks separate without deducting them from worked time", () => {
    expect(
      workforceAttendanceTotals({
        ...snapshot,
        breaks: [{ ...snapshot.breaks[0]!, kind: "PAID" }],
      }),
    ).toMatchObject({
      workedMinutes: 480,
      paidBreakMinutes: 30,
      unpaidBreakMinutes: 0,
    });
  });
  it("never deducts an unrecorded planned break", () => {
    expect(
      workforceAttendanceTotals({ ...snapshot, breaks: [] }),
    ).toMatchObject({ workedMinutes: 480, breakMinutes: 0 });
  });
  it("sums multiple breaks and rounds only the final exact durations", () => {
    expect(
      workforceAttendanceTotals({
        ...snapshot,
        breaks: [
          { ...snapshot.breaks[0]!, endsAt: "2030-08-12T11:00:30Z" },
          {
            startsAt: "2030-08-12T13:00:00Z",
            endsAt: "2030-08-12T13:00:30Z",
            kind: "UNPAID",
          },
        ],
      }),
    ).toMatchObject({ breakMinutes: 1, workedMinutes: 479 });
  });
  it("rejects overlapping or outside correction breaks", () => {
    expect(() =>
      workforceAttendanceTotals({
        ...snapshot,
        breaks: [...snapshot.breaks, { ...snapshot.breaks[0]! }],
      }),
    ).toThrow();
    expect(() =>
      workforceAttendanceTotals({
        ...snapshot,
        breaks: [{ ...snapshot.breaks[0]!, endsAt: "2030-08-12T17:00Z" }],
      }),
    ).toThrow();
  });
  it("allows zero elapsed time for a just-started live clock", () => {
    expect(
      workforceAttendanceTotals({
        ...snapshot,
        endsAt: snapshot.startsAt,
        breaks: [],
      }),
    ).toMatchObject({ workedMs: 0, workedMinutes: 0 });
  });
  it.each([
    [null, "BREAK_START"],
    [null, "CLOCK_OUT"],
    ["WORKING", "CLOCK_IN"],
    ["BREAK", "BREAK_START"],
    ["BREAK", "CLOCK_OUT"],
    ["CLOSED", "CLOCK_IN"],
  ] as const)("blocks invalid transition %s → %s", (state, kind) => {
    expect(() => assertAttendanceTransition(state, kind)).toThrow();
  });
  it("replays actual events and keeps original evidence after compensation", () => {
    const events = [
      e("CLOCK_IN", 1, snapshot.startsAt),
      e("BREAK_START", 2, snapshot.breaks[0]!.startsAt, {
        breakKind: "UNPAID",
      }),
      e("BREAK_END", 3, snapshot.breaks[0]!.endsAt),
      e("CLOCK_OUT", 4, snapshot.endsAt),
      e("CORRECTION", 5, "2030-08-13T08:00Z", {
        snapshot: { ...snapshot, endsAt: "2030-08-12T16:00Z" },
      }),
    ];
    expect(workforceAttendanceState(events)).toBe("CLOSED");
    expect(workforceOriginalAttendance(events, "2030-08-13T09:00Z")).toEqual(
      snapshot,
    );
  });
  it("compensates missing punches without inventing an original clock out", () => {
    const events = [
      e("CLOCK_IN", 1, snapshot.startsAt),
      e("CORRECTION", 2, "2030-08-13T08:00Z", { snapshot }),
    ];
    expect(workforceAttendanceState(events)).toBe("CLOSED");
    expect(events.some((e) => e.kind === "CLOCK_OUT")).toBe(false);
  });
  it("uses elapsed UTC time through overnight spring and autumn DST", () => {
    for (const timezone of ["Europe/Berlin", "Europe/Tirane"]) {
      const spring = {
        startsAt: workforceRecordedInstant("2030-03-31T00:00", timezone),
        endsAt: workforceRecordedInstant("2030-03-31T06:00", timezone),
        breaks: [],
      };
      const autumn = {
        startsAt: workforceRecordedInstant("2030-10-27T00:00", timezone),
        endsAt: workforceRecordedInstant("2030-10-27T06:00", timezone),
        breaks: [],
      };
      expect(workforceAttendanceTotals(spring).workedMinutes).toBe(300);
      expect(workforceAttendanceTotals(autumn).workedMinutes).toBe(420);
    }
  });
  it("rejects gaps and requires an explicit fold offset, at minute precision", () => {
    expect(() =>
      workforceRecordedInstant("2030-03-31T02:17", "Europe/Berlin", "earlier"),
    ).toThrow();
    expect(() =>
      workforceRecordedInstant("2030-10-27T02:17", "Europe/Berlin"),
    ).toThrow();
    expect(
      Date.parse(
        workforceRecordedInstant("2030-10-27T02:17", "Europe/Berlin", "later"),
      ) -
        Date.parse(
          workforceRecordedInstant(
            "2030-10-27T02:17",
            "Europe/Berlin",
            "earlier",
          ),
        ),
    ).toBe(3600000);
  });
  it("returns reviewable DE break and rest warnings without changing minutes", () => {
    const rules = workforceDefaultRules("DE");
    expect(
      workforceAttendanceWarnings(
        { ...snapshot, breaks: [] },
        rules,
        "2030-08-12T00:00Z",
      ),
    ).toEqual(
      expect.arrayContaining(["BREAK_SHORT", "CONTINUOUS_WORK", "REST_SHORT"]),
    );
    expect(workforceAttendanceWarnings(snapshot, rules)).toEqual([]);
    expect(
      workforceAttendanceWarnings(
        { ...snapshot, breaks: [] },
        workforceDefaultRules("AL"),
      ),
    ).toEqual([]);
  });
  it("requires independent review and strict server clock inputs", () => {
    expect(() => assertIndependentWorkforceReview("a", "a")).toThrow();
    expect(() => assertIndependentWorkforceReview("a", "b")).not.toThrow();
    expect(() =>
      workforcePunchSchema.parse({
        kind: "CLOCK_IN",
        expectedVersion: 0,
        idempotencyKey: "synthetic-key",
        occurredAt: "2030-01-01T00:00Z",
      }),
    ).toThrow();
  });
});
describe("WF2 frozen leave and request decisions", () => {
  const rules = workforceDefaultRules("DE"),
    policies = [
      {
        id: "p1",
        version: 1,
        effectiveFrom: "2030-01-01",
        countryCode: "DE",
        rules,
      },
    ],
    contracts = [
      {
        id: "c1",
        version: 1,
        effectiveFrom: "2030-01-01",
        weeklyTargetMinutes: 2400,
        countryCode: "DE",
      },
      {
        id: "c2",
        version: 2,
        effectiveFrom: "2030-08-13",
        weeklyTargetMinutes: 1200,
        countryCode: "DE",
      },
    ];
  const input = {
    idempotencyKey: "leave-synthetic",
    category: "ANNUAL",
    from: "2030-08-12",
    to: "2030-08-13",
    partial: null,
  };
  it("freezes each day's exact effective contract and policy", () => {
    expect(
      workforceLeaveSlices(input, "Europe/Berlin", contracts, policies).map(
        (s) => [s.chargedMinutes, s.contractRevisionId, s.policyRevisionId],
      ),
    ).toEqual([
      [480, "c1", "p1"],
      [240, "c2", "p1"],
    ]);
  });
  it("uses explicitly configured workdays with no invented accrual or weekend debit", () => {
    expect(
      workforceLeaveSlices(
        { ...input, from: "2030-08-17", to: "2030-08-18" },
        "Europe/Berlin",
        contracts,
        policies,
      ).map((s) => s.chargedMinutes),
    ).toEqual([0, 0]);
  });
  it("charges partial-day actual elapsed minutes", () => {
    expect(
      workforceLeaveSlices(
        {
          ...input,
          to: input.from,
          partial: {
            startsLocal: "2030-08-12T09:15",
            endsLocal: "2030-08-12T11:15",
            startChoice: "reject",
            endChoice: "reject",
          },
        },
        "Europe/Berlin",
        contracts,
        policies,
      )[0]!.chargedMinutes,
    ).toBe(120);
  });
  it("blocks unknown targets, country mismatch and unsupported categories", () => {
    expect(() =>
      workforceLeaveSlices(input, "Europe/Berlin", [], policies),
    ).toThrow();
    expect(() =>
      workforceLeaveSlices(
        input,
        "Europe/Berlin",
        contracts,
        policies.map((p) => ({ ...p, countryCode: "AL" })),
      ),
    ).toThrow();
    expect(() =>
      workforceLeaveSlices(
        { ...input, category: "SECRET" },
        "Europe/Berlin",
        contracts,
        policies,
      ),
    ).toThrow();
  });
  it("does not accept diagnoses or arbitrary medical evidence", () => {
    expect(() =>
      workforceLeaveSchema.parse({
        ...input,
        category: "SICKNESS",
        diagnosis: "private",
      }),
    ).toThrow();
  });
  it("requires coworker acceptance before swap approval", () => {
    expect(() =>
      workforceRequestTransition("PENDING", "APPROVE", "SWAP"),
    ).toThrow();
    expect(workforceRequestTransition("PENDING", "ACCEPT", "SWAP")).toBe(
      "ACCEPTED",
    );
    expect(workforceRequestTransition("ACCEPTED", "APPROVE", "SWAP")).toBe(
      "APPROVED",
    );
  });
  it("preserves approved leave through a separate cancellation transition", () => {
    expect(
      workforceRequestTransition("APPROVED", "CANCEL_APPROVED", "LEAVE"),
    ).toBe("CANCELLED");
    expect(() =>
      workforceRequestTransition("APPROVED", "WITHDRAW", "LEAVE"),
    ).toThrow();
    expect(() =>
      workforceRequestTransition("REJECTED", "APPROVE", "LEAVE"),
    ).toThrow();
  });
});

it("allocates real unpaid intervals across local midnight and rounds aggregate milliseconds once", () => {
  const v = {
    startsAt: "2030-08-12T20:00:00Z",
    endsAt: "2030-08-13T02:00:00Z",
    breaks: [
      {
        startsAt: "2030-08-12T21:45:00Z",
        endsAt: "2030-08-12T22:15:00Z",
        kind: "UNPAID" as const,
      },
    ],
  };
  expect(
    workforceAttendanceWindowTotals(
      v,
      Date.parse("2030-08-11T22:00Z"),
      Date.parse("2030-08-12T22:00Z"),
    ).workedMinutes,
  ).toBe(105);
  expect(
    workforceAttendanceWindowTotals(
      v,
      Date.parse("2030-08-12T22:00Z"),
      Date.parse("2030-08-13T22:00Z"),
    ).workedMinutes,
  ).toBe(225);
  const half = workforceAttendanceTotals({
    startsAt: "2030-01-01T00:00:00Z",
    endsAt: "2030-01-01T00:00:30Z",
    breaks: [],
  });
  expect(workforceSumAttendanceTotals([half, half]).workedMinutes).toBe(1);
});
it("excludes only explicitly configured holiday dates from annual debit", () => {
  const policy = {
    id: "p",
    version: 1,
    effectiveFrom: "2030-01-01",
    countryCode: "AL",
    rules: {
      ...workforceDefaultRules("AL"),
      excludedLeaveDates: ["2030-08-12"],
    },
  };
  const slices = workforceLeaveSlices(
    {
      idempotencyKey: "synthetic-leave",
      category: "ANNUAL",
      from: "2030-08-12",
      to: "2030-08-12",
      partial: null,
    },
    "Europe/Tirane",
    [
      {
        id: "c",
        version: 1,
        effectiveFrom: "2030-01-01",
        weeklyTargetMinutes: 2400,
        countryCode: "AL",
      },
    ],
    [policy],
  );
  expect(slices[0]!.chargedMinutes).toBe(0);
});

it("requires configured sufficient annual allowance and preserves already consumed entitlement", () => {
  expect(() => assertWorkforceLeaveAllowance(false, null, 0, 120)).toThrow();
  expect(() => assertWorkforceLeaveAllowance(true, 480, 360, 240)).toThrow();
  expect(() =>
    assertWorkforceLeaveAllowance(true, 480, 360, 120),
  ).not.toThrow();
});
it("allows an explicit first policy baseline, then blocks later backdating", () => {
  expect(() =>
    assertWorkforcePolicyDate("2026-01-01", null, "2030-08-12"),
  ).not.toThrow();
  expect(() =>
    assertWorkforcePolicyDate(
      "2030-08-11",
      { effectiveFrom: "2026-01-01" },
      "2030-08-12",
    ),
  ).toThrow();
});
it("rejects future correction periods", () => {
  expect(() =>
    assertWorkforceCorrectionPeriod(snapshot, "2030-08-12T14:00Z"),
  ).toThrow();
  expect(() =>
    assertWorkforceCorrectionPeriod(snapshot, "2030-08-12T16:00Z"),
  ).not.toThrow();
});
it("derives UI actions from one domain consent/independent-review policy", () => {
  const r = {
    kind: "SWAP",
    status: "PENDING",
    userId: "worker",
    invitedUserId: "peer",
  };
  expect(
    workforceRequestActions(r, { userId: "manager", canManage: true }),
  ).toEqual(["REJECT"]);
  expect(
    workforceRequestActions(
      { ...r, status: "ACCEPTED" },
      { userId: "manager", canManage: true },
    ),
  ).toContain("APPROVE");
  expect(
    workforceRequestActions(
      { ...r, status: "ACCEPTED" },
      { userId: "worker", canManage: true },
    ),
  ).not.toContain("APPROVE");
  expect(
    workforceRequestActions(r, { userId: "peer", canManage: false }),
  ).toEqual(["ACCEPT", "DECLINE"]);
});

it("manager recovery proposals also require an independent reviewer", () => {
  const r = {
    kind: "CORRECTION",
    status: "PENDING",
    userId: "inactive-worker",
    invitedUserId: null,
    createdByUserId: "manager",
  };
  expect(
    workforceRequestActions(r, { userId: "manager", canManage: true }),
  ).not.toContain("APPROVE");
  expect(
    workforceRequestActions(r, { userId: "other-manager", canManage: true }),
  ).toContain("APPROVE");
  expect(
    workforceRequestActions(r, { userId: "manager", canManage: true }),
  ).toContain("WITHDRAW");
});
