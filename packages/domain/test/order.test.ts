import { describe, expect, it } from "vitest";

import { InvalidOrderTransitionError, transitionOrder } from "../src/index.js";

describe("transitionOrder", () => {
  it("advances through the normal preparation flow", () => {
    expect(transitionOrder("NEW", "ACCEPTED")).toBe("ACCEPTED");
    expect(transitionOrder("PREPARING", "READY")).toBe("READY");
    expect(transitionOrder("READY", "SERVED")).toBe("SERVED");
  });

  it("rejects skipped states", () => {
    expect(() => transitionOrder("NEW", "READY")).toThrow(
      InvalidOrderTransitionError,
    );
  });

  it("does not allow a terminal order to be reopened", () => {
    expect(() => transitionOrder("SERVED", "PREPARING")).toThrow(
      "Order cannot transition from SERVED to PREPARING",
    );
  });
});
