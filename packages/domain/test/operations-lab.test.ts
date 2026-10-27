import { describe, expect, it } from "vitest";
import {
  assertLabRunTransition,
  assertLabCompletion,
  labReplayPolicy,
  labRunSchema,
} from "../src/operations-lab";
describe("operations lab contracts", () => {
  it("returns durable outcomes and requires review for ambiguous non-idempotent writes", () => {
    expect(labReplayPolicy("SUCCEEDED", false)).toBe("RETURN");
    expect(labReplayPolicy("LEASED", false)).toBe("REVIEW");
    expect(labReplayPolicy("LEASED", true)).toBe("EXECUTE");
    expect(labReplayPolicy("NEEDS_REVIEW", true)).toBe("REVIEW");
    expect(labReplayPolicy("CORRUPT", true)).toBe("REVIEW");
  });
  it("keeps completed runs terminal and requires explicit review resolution", () => {
    expect(() => assertLabRunTransition("RUNNING", "PAUSED")).not.toThrow();
    expect(() => assertLabRunTransition("COMPLETED", "RUNNING")).toThrow();
    expect(() => assertLabRunTransition("NEEDS_REVIEW", "RUNNING")).toThrow();
    expect(() =>
      assertLabRunTransition("NEEDS_REVIEW", "PAUSED"),
    ).not.toThrow();
  });
  it("rejects unversioned or unscoped runs", () => {
    expect(labRunSchema.safeParse({ version: 2 }).success).toBe(false);
    expect(labRunSchema.safeParse({ version: 1, tenantId: "" }).success).toBe(
      false,
    );
  });
  it("requires complete independent evidence before completion or a review recheck", () => {
    expect(() => assertLabCompletion("NEEDS_REVIEW", 0, 0)).not.toThrow();
    expect(() => assertLabCompletion("RUNNING", 1, 0)).toThrow();
    expect(() => assertLabCompletion("RUNNING", 0, 1)).toThrow();
    expect(() => assertLabCompletion("PAUSED", 0, 0)).toThrow();
  });
});
