import { describe, expect, it } from "vitest";
import {
  assertLegalHoldSchedule,
  InvalidLegalHoldError,
} from "../src/index.js";

describe("legal holds", () => {
  it("requires a bounded, reviewable hold", () => {
    expect(() =>
      assertLegalHoldSchedule({
        reason: "Dispute",
        now: new Date("2026-08-11T00:00:00Z"),
        reviewAt: new Date("2026-08-20T00:00:00Z"),
        expiresAt: new Date("2026-09-01T00:00:00Z"),
      }),
    ).not.toThrow();
  });
  it("rejects an unbounded hold", () => {
    expect(() =>
      assertLegalHoldSchedule({
        reason: "",
        now: new Date("2026-08-11T00:00:00Z"),
        reviewAt: new Date("2026-08-10T00:00:00Z"),
        expiresAt: new Date("2026-08-10T00:00:00Z"),
      }),
    ).toThrow(InvalidLegalHoldError);
  });
});
