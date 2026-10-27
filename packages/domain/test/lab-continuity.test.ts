import { describe, it, expect } from "vitest";
import { labTestRenewal } from "../src/lab-continuity";
import { PLAN_DEFINITIONS } from "../src/subscription";
describe("bounded synthetic lab test validity", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  it("requires opt-in and never activates a commercial subscription", () => {
    expect(labTestRenewal(false, "TRIALING", new Date(0), now)).toBeNull();
    expect(() => labTestRenewal(true, "ACTIVE", new Date(0), now)).toThrow();
    expect(() => labTestRenewal(true, "CANCELLED", new Date(0), now)).toThrow();
    expect(
      Object.values(PLAN_DEFINITIONS).every((p) => p.trialDays === 14),
    ).toBe(true);
  });
  it("grants 30 real days and renews only inside the seven-day window", () => {
    const first = labTestRenewal(
      true,
      "TRIALING",
      new Date("2026-10-25T12:00:00Z"),
      now,
      true,
    )!;
    expect(first.toISOString()).toBe("2026-11-10T12:00:00.000Z");
    expect(labTestRenewal(true, "TRIALING", first, now)).toBeNull();
    expect(
      labTestRenewal(
        true,
        "TRIALING",
        first,
        new Date("2026-11-04T12:00:00Z"),
      )!.toISOString(),
    ).toBe("2026-12-04T12:00:00.000Z");
    expect(
      labTestRenewal(true, "TRIALING", new Date(0), now)!.getTime() -
        now.getTime(),
    ).toBe(30 * 86400000);
  });
});
