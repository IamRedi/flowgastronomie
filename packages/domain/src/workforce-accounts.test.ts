import { describe, it, expect } from "vitest";
import {
  workforceMonthlyAccount,
  workforceMonthRange,
  workforceMonthSchema,
  workforceAccountPolicyWriteSchema,
  workforceCarryMilliseconds,
  workforceCsvCell,
  assertWorkforceMonthlyClose,
  type WorkforceMonthlyInput,
  type WorkforceMonthlyAttendance,
  type WorkforceAccountRules,
} from "./workforce-accounts";
const rules: WorkforceAccountRules = {
  timezone: "Europe/Berlin",
  workingWeekdays: [1, 2, 3, 4, 5],
  targetBasis: "WEEKLY_WORKDAYS",
  plannedBreakTreatment: "UNPAID",
  plannedBreakAllocation: "PROPORTIONAL",
  paidLeaveCategories: ["ANNUAL"],
  holidays: [],
  creditOverlapRule: "LIMIT_TO_TARGET",
  overtimeBasis: "APPROVED_OVER_TARGET",
  carryoverMode: "NONE",
  carryPositiveLimitMinutes: null,
  carryNegativeLimitMinutes: null,
  openingMonth: null,
  openingBalanceMinutes: 0,
  retentionYears: 2,
  legalReviewConfirmed: true,
};
function input(month = "2030-08"): WorkforceMonthlyInput {
  return {
    month,
    timezone: rules.timezone,
    employmentStartedOn: "2026-01-01",
    employmentEndedOn: null,
    contracts: [
      {
        id: "contract1",
        version: 1,
        effectiveFrom: "2026-01-01",
        countryCode: "DE",
        weeklyTargetMinutes: 2400,
        monthlyTargetMinutes: null,
        createdByUserId: "owner",
        createdAt: "2026-01-01T00:00Z",
      },
    ],
    policies: [
      {
        id: "account-policy1",
        version: 1,
        effectiveFrom: "2026-01-01",
        countryCode: "DE",
        rules: structuredClone(rules),
        createdByUserId: "owner",
        createdAt: "2026-01-01T00:00Z",
      },
    ],
    planned: [],
    attendance: [],
    leave: [],
    pendingRequestIds: [],
    carryMs: 0,
    carrySourceIds: [],
  };
}
function attendance(
  id: string,
  startsAt: string,
  endsAt: string,
  breaks: WorkforceMonthlyAttendance["snapshot"] extends infer X
    ? { startsAt: string; endsAt: string; kind: "PAID" | "UNPAID" }[]
    : never = [],
): WorkforceMonthlyAttendance {
  const snapshot = { startsAt, endsAt, breaks };
  return {
    id,
    state: "CLOSED",
    version: 2,
    timezone: rules.timezone,
    contractRevisionId: "contract1",
    policyRevisionId: "operational1",
    sourceEventIds: [id + ":in", id + ":out"],
    snapshot,
    recordedAt: startsAt,
    actorUserId: "worker",
    approval: {
      id: id + ":approval",
      snapshot,
      sourceEventIds: [id + ":in", id + ":out"],
      actorUserId: "manager",
      createdAt: endsAt,
      contractRevisionId: "contract1",
      policyRevisionId: "operational1",
    },
  };
}
describe("WF3 complete monthly accounting", () => {
  it("reconciles 480 presence, 30 unpaid break, 450 actual/approved and contract target with provenance", () => {
    const v = input();
    v.attendance = [
      attendance("a", "2030-08-12T07:00Z", "2030-08-12T15:00Z", [
        {
          startsAt: "2030-08-12T10:00Z",
          endsAt: "2030-08-12T10:30Z",
          kind: "UNPAID",
        },
      ]),
    ];
    const a = workforceMonthlyAccount(v);
    expect(a.totals.actualPresenceMs).toBe(480 * 60000);
    expect(a.totals.actualMs).toBe(450 * 60000);
    expect(a.totals.approvedMs).toBe(450 * 60000);
    expect(a.totals.targetMs).toBe(22 * 480 * 60000);
    expect(a.entries.find((e) => e.category === "APPROVED")).toMatchObject({
      approvalId: "a:approval",
      actorUserId: "manager",
      contractRevisionId: "contract1",
      policyRevisionId: "operational1",
      sourceEventIds: ["a:in", "a:out"],
    });
  });
  it("reads 251 records without per-record rounding or hidden list truncation", () => {
    const v = input(),
      start = Date.parse("2030-08-12T07:00Z");
    v.attendance = Array.from({ length: 251 }, (_, i) =>
      attendance(
        String(i),
        new Date(start + i * 60000).toISOString(),
        new Date(start + i * 60000 + 30001).toISOString(),
      ),
    );
    const a = workforceMonthlyAccount(v);
    expect(a.entries.filter((e) => e.category === "APPROVED")).toHaveLength(
      251,
    );
    expect(a.totals.approvedMs).toBe(251 * 30001);
  });
  it("rejects duplicate source identities rather than inflating hours", () => {
    const v = input(),
      a = attendance("a", "2030-08-12T07:00Z", "2030-08-12T08:00Z");
    v.attendance = [a, a];
    expect(() => workforceMonthlyAccount(v)).toThrow("Duplicate canonical");
  });
  it("splits an overnight session and its actual break across month boundaries", () => {
    const a = attendance("midnight", "2030-01-31T22:30Z", "2030-02-01T00:30Z", [
      {
        startsAt: "2030-01-31T22:45Z",
        endsAt: "2030-01-31T23:15Z",
        kind: "UNPAID",
      },
    ]);
    const jan = input("2030-01"),
      feb = input("2030-02");
    jan.attendance = [a];
    feb.attendance = [a];
    expect(workforceMonthlyAccount(jan).totals.approvedMs).toBe(15 * 60000);
    expect(workforceMonthlyAccount(feb).totals.approvedMs).toBe(75 * 60000);
  });
  it.each([
    ["2030-03", "2030-03-31", 23],
    ["2030-10", "2030-10-27", 25],
  ] as const)("uses elapsed UTC on %s DST day", (month, day, hours) => {
    const v = input(month),
      r = workforceMonthRange(month, v.timezone);
    expect(r.end).toBeGreaterThan(r.start);
    const from =
      new Date(day + "T00:00:00+01:00").getTime() -
      (hours === 25 ? 3600000 : 0);
    v.attendance = [
      attendance(
        "dst",
        new Date(from).toISOString(),
        new Date(from + hours * 3600000).toISOString(),
      ),
    ];
    expect(workforceMonthlyAccount(v).totals.approvedMs).toBe(hours * 3600000);
  });
  it("uses effective contract targets on the correct mid-month working dates", () => {
    const v = input();
    v.contracts.push({
      ...v.contracts[0]!,
      id: "contract2",
      version: 2,
      effectiveFrom: "2030-08-16",
      weeklyTargetMinutes: 1200,
    });
    const a = workforceMonthlyAccount(v);
    expect(
      a.targetDays.find((d) => d.date === "2030-08-15")?.milliseconds,
    ).toBe(480 * 60000);
    expect(
      a.targetDays.find((d) => d.date === "2030-08-16")?.milliseconds,
    ).toBe(240 * 60000);
    expect(
      a.entries
        .filter((e) => e.category === "TARGET")
        .some((e) => e.contractRevisionId === "contract2"),
    ).toBe(true);
  });
  it("supports an explicitly confirmed monthly target allocation", () => {
    const v = input();
    v.contracts[0]!.monthlyTargetMinutes = 9000;
    v.policies[0]!.rules.targetBasis = "MONTHLY_WORKDAYS";
    expect(workforceMonthlyAccount(v).totals.targetMs).toBe(9000 * 60000);
  });
  it("does not invent a missing contract, monthly target or country policy", () => {
    const v = input();
    v.contracts = [];
    expect(workforceMonthlyAccount(v).totals.balanceMs).toBe(null);
    const m = input();
    m.policies[0]!.rules.targetBasis = "MONTHLY_WORKDAYS";
    expect(workforceMonthlyAccount(m).warnings).toContain(
      "TARGET_UNCONFIGURED",
    );
    const c = input();
    c.contracts[0]!.countryCode = "AL";
    expect(workforceMonthlyAccount(c).warnings).toContain(
      "ACCOUNT_POLICY_UNCONFIGURED",
    );
  });
  it("paid breaks remain paid work and unpaid breaks remain a separate deduction", () => {
    const v = input();
    v.attendance = [
      attendance("a", "2030-08-12T07:00Z", "2030-08-12T15:00Z", [
        {
          startsAt: "2030-08-12T10:00Z",
          endsAt: "2030-08-12T10:30Z",
          kind: "PAID",
        },
      ]),
    ];
    const a = workforceMonthlyAccount(v);
    expect(a.totals.approvedMs).toBe(480 * 60000);
    expect(a.totals.approvedPaidBreakMs).toBe(30 * 60000);
    expect(a.totals.approvedUnpaidBreakMs).toBe(0);
  });
  it("credits confirmed paid leave only, caps lost target time and keeps the decision source", () => {
    const v = input();
    v.leave = [
      {
        id: "leave",
        category: "ANNUAL",
        status: "APPROVED",
        decisionId: "decision",
        actorUserId: "manager",
        occurredAt: "2030-08-10T10:00Z",
        slices: [
          {
            date: "2030-08-12",
            year: 2030,
            startsAt: "2030-08-11T22:00Z",
            endsAt: "2030-08-12T22:00Z",
            chargedMinutes: 480,
            contractRevisionId: "contract1",
            policyRevisionId: "op1",
          },
        ],
      },
    ];
    v.attendance = [attendance("a", "2030-08-12T07:00Z", "2030-08-12T11:00Z")];
    const a = workforceMonthlyAccount(v);
    expect(a.totals.creditedMs).toBe(240 * 60000);
    expect(a.entries.find((e) => e.category === "CREDITED")).toMatchObject({
      sourceId: "leave",
      leaveDecisionId: "decision",
    });
    v.leave[0]!.category = "UNPAID";
    expect(workforceMonthlyAccount(v).totals.creditedMs).toBe(0);
    v.leave[0]!.status = "CANCELLED";
    expect(workforceMonthlyAccount(v).totals.creditedMs).toBe(0);
  });
  it("credits only confirmed holidays and avoids double credit with annual leave", () => {
    const v = input();
    v.policies[0]!.rules.holidays = [
      { date: "2030-08-12", label: "Confirmed synthetic holiday" },
    ];
    v.leave = [
      {
        id: "leave",
        category: "ANNUAL",
        status: "APPROVED",
        decisionId: "decision",
        actorUserId: "manager",
        occurredAt: "2030-08-10T10:00Z",
        slices: [
          {
            date: "2030-08-12",
            year: 2030,
            startsAt: "2030-08-11T22:00Z",
            endsAt: "2030-08-12T22:00Z",
            chargedMinutes: 480,
            contractRevisionId: "contract1",
            policyRevisionId: "op1",
          },
        ],
      },
    ];
    const a = workforceMonthlyAccount(v);
    expect(a.totals.creditedMs).toBe(480 * 60000);
    expect(
      a.entries.find((e) => e.sourceKind === "CONFIRMED_HOLIDAY")
        ?.accountPolicyRevisionId,
    ).toBe("account-policy1");
  });
  it("offboarding dates bound targets without erasing recorded work", () => {
    const v = input();
    v.employmentEndedOn = "2030-08-15";
    v.attendance = [
      attendance("history", "2030-08-16T07:00Z", "2030-08-16T08:00Z"),
    ];
    const a = workforceMonthlyAccount(v);
    expect(
      a.targetDays.find((d) => d.date === "2030-08-16")?.milliseconds,
    ).toBe(0);
    expect(a.totals.approvedMs).toBe(60000 * 60);
  });
  it("a month with no activity retains its confirmed target and exact negative variance", () => {
    const a = workforceMonthlyAccount(input());
    expect(a.totals.actualMs).toBe(0);
    expect(a.totals.balanceMs).toBe(-22 * 480 * 60000);
  });
  it("overtime and carryover are configured choices, not payroll guesses", () => {
    const v = input();
    v.contracts[0]!.weeklyTargetMinutes = 0;
    v.attendance = [attendance("a", "2030-08-12T07:00Z", "2030-08-12T08:00Z")];
    expect(workforceMonthlyAccount(v).totals.overtimeMs).toBe(60 * 60000);
    v.policies[0]!.rules.overtimeBasis = "DISABLED";
    expect(workforceMonthlyAccount(v).totals.overtimeMs).toBe(null);
    const r = {
      ...rules,
      carryoverMode: "BALANCE" as const,
      carryPositiveLimitMinutes: 120,
      carryNegativeLimitMinutes: 60,
    };
    expect(workforceCarryMilliseconds(150 * 60000, r)).toBe(120 * 60000);
    expect(workforceCarryMilliseconds(-90 * 60000, r)).toBe(-60 * 60000);
    expect(workforceCarryMilliseconds(60000, rules)).toBe(0);
  });
  it("closing requires an ended, reviewed and fully resolved month", () => {
    const a = workforceMonthlyAccount(input());
    expect(() =>
      assertWorkforceMonthlyClose(a, new Date("2030-09-01T00:00Z"), true),
    ).not.toThrow();
    expect(() =>
      assertWorkforceMonthlyClose(a, new Date("2030-08-20T00:00Z"), true),
    ).toThrow("ended");
    expect(() =>
      assertWorkforceMonthlyClose(a, new Date("2030-09-01T00:00Z"), false),
    ).toThrow("confirm");
    const v = input();
    v.pendingRequestIds = ["pending"];
    expect(() =>
      assertWorkforceMonthlyClose(
        workforceMonthlyAccount(v),
        new Date("2030-09-01T00:00Z"),
        true,
      ),
    ).toThrow("Resolve");
  });
  it("historical target days remain frozen after later profile/contract changes", () => {
    const v = input(),
      a = workforceMonthlyAccount(v);
    v.frozenTargetDays = a.targetDays;
    v.contracts[0]!.weeklyTargetMinutes = 100;
    expect(workforceMonthlyAccount(v).totals.targetMs).toBe(a.totals.targetMs);
  });
  it.each(["=HYPERLINK(1)", "+cmd", "-cmd", "@SUM(A1)", " \t=1", "\r=1"])(
    "neutralizes CSV formula input %j",
    (text) => expect(workforceCsvCell(text)).toMatch(/^"'/),
  );
  it("escapes quotes/newlines, preserves safe numeric negative balances and rejects invalid report numbers", () => {
    expect(workforceCsvCell('a"b\nc')).toBe('"a""b\nc"');
    expect(workforceCsvCell(-50)).toBe("-50");
    expect(() => workforceCsvCell(NaN)).toThrow();
  });

  it("allocates a known published break proportionally across a month boundary with explicit policy", () => {
    const jan = input("2030-01"),
      feb = input("2030-02"),
      planned = {
        id: "pub",
        scheduleRevisionId: "schedule",
        actorUserId: "manager",
        createdAt: "2030-01-01T00:00Z",
        assignment: {
          id: "shift",
          membershipId: "member",
          userId: "worker",
          displayName: "Synthetic",
          role: "WAITER" as const,
          station: "KITCHEN",
          startsLocal: "2030-01-31T23:30",
          endsLocal: "2030-02-01T01:30",
          startsAt: "2030-01-31T22:30Z",
          endsAt: "2030-02-01T00:30Z",
          startChoice: "reject" as const,
          endChoice: "reject" as const,
          breakMinutes: 30,
          requiredSkills: [],
          note: "",
        },
      };
    jan.planned = [planned];
    feb.planned = [planned];
    expect(workforceMonthlyAccount(jan).totals.plannedMs).toBe(22.5 * 60000);
    expect(workforceMonthlyAccount(feb).totals.plannedMs).toBe(67.5 * 60000);
    jan.policies[0]!.rules.plannedBreakTreatment = "PAID";
    expect(workforceMonthlyAccount(jan).totals.plannedMs).toBe(30 * 60000);
  });
  it("does not silently treat missing credit rules or planned break configuration as approved zero", () => {
    const v = input();
    v.policies = [];
    v.planned = [
      {
        id: "pub",
        scheduleRevisionId: "schedule",
        actorUserId: "manager",
        createdAt: "2030-01-01T00:00Z",
        assignment: {
          id: "shift",
          membershipId: "member",
          userId: "worker",
          displayName: "Synthetic",
          role: "WAITER",
          station: "KITCHEN",
          startsLocal: "2030-08-12T09:00",
          endsLocal: "2030-08-12T10:00",
          startsAt: "2030-08-12T07:00Z",
          endsAt: "2030-08-12T08:00Z",
          startChoice: "reject",
          endChoice: "reject",
          breakMinutes: 0,
          requiredSkills: [],
          note: "",
        },
      },
    ];
    const a = workforceMonthlyAccount(v);
    expect(a.totals.plannedMs).toBe(null);
    expect(a.totals.creditedMs).toBe(null);
    expect(a.totals.balanceMs).toBe(null);
  });

  it("an explicit recorded-work overlap rule credits approved partial leave outside worked intervals without silently capping it", () => {
    const v = input();
    v.employmentStartedOn = "2030-08-12";
    v.employmentEndedOn = "2030-08-12";
    v.policies[0]!.rules.creditOverlapRule = "EXCLUDE_RECORDED_WORK";
    v.policies[0]!.rules.overtimeBasis = "EARNED_OVER_TARGET";
    v.attendance = [attendance("a", "2030-08-12T09:00Z", "2030-08-12T17:00Z")];
    v.leave = [
      {
        id: "paid",
        category: "ANNUAL",
        status: "APPROVED",
        decisionId: "decision",
        actorUserId: "manager",
        occurredAt: "2030-08-01T10:00Z",
        slices: [
          {
            date: "2030-08-12",
            year: 2030,
            startsAt: "2030-08-12T07:00Z",
            endsAt: "2030-08-12T09:00Z",
            chargedMinutes: 120,
            contractRevisionId: "contract1",
            policyRevisionId: "op1",
          },
        ],
      },
    ];
    const a = workforceMonthlyAccount(v);
    expect(a.totals.creditedMs).toBe(120 * 60000);
    expect(a.totals.overtimeMs).toBe(120 * 60000);
    expect(a.absences[0]).toMatchObject({
      category: "ANNUAL",
      status: "APPROVED",
      chargedMinutes: 120,
      creditedMs: 120 * 60000,
    });
    v.leave[0]!.category = "UNPAID";
    const unpaid = workforceMonthlyAccount(v);
    expect(unpaid.totals.creditedMs).toBe(0);
    expect(unpaid.absences[0]?.chargedMinutes).toBe(120);
  });
  it("rejects impossible months and country configuration without explicit legal review", () => {
    expect(workforceMonthSchema.safeParse("2030-13").success).toBe(false);
    expect(
      workforceAccountPolicyWriteSchema.safeParse({
        expectedVersion: 0,
        effectiveFrom: "2030-01-01",
        countryCode: "DE",
        rules: { ...rules, retentionYears: 1 },
        reason: "Confirmed",
        reviewConfirmed: true,
      }).success,
    ).toBe(false);
  });
});
