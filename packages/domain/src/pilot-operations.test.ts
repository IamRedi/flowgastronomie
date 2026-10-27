import { describe, expect, it } from "vitest";
import {
  canCompletePickup,
  counterOrderVisible,
  orderReference,
  productionStations,
  simpleProductionStatus,
  pilotOrderMatchesView,
} from "./pilot-operations";
describe("pilot operational semantics", () => {
  it("keeps payment and production independent", () => {
    expect(counterOrderVisible("ACCEPTED", false)).toBe(true);
    expect(counterOrderVisible("PREPARING", true)).toBe(true);
    expect(counterOrderVisible("READY", true)).toBe(true);
    expect(counterOrderVisible("SERVED", false)).toBe(true);
    expect(counterOrderVisible("SERVED", true)).toBe(false);
    expect(counterOrderVisible("READY", false, true)).toBe(false);
    expect(counterOrderVisible("CANCELLED", false)).toBe(false);
  });
  it("requires all stations ready before handoff", () => {
    expect(canCompletePickup(["READY", "SERVED"])).toBe(true);
    expect(canCompletePickup(["READY", "PREPARING"])).toBe(false);
    expect(canCompletePickup([])).toBe(false);
    expect(canCompletePickup(["SERVED"])).toBe(false);
  });
  it("limits station visibility without granting new permissions", () => {
    expect(productionStations("KITCHEN", "KITCHEN")).toEqual([
      "KITCHEN",
      "DESSERT",
    ]);
    expect(productionStations("KITCHEN", "BAR")).toEqual([]);
    expect(productionStations("WAITER", "KITCHEN")).toEqual([]);
    expect(productionStations("MANAGER", "BAR")).toEqual(["BAR"]);
    expect(orderReference("cm123456abcdefgh")).toBe("ABCDEFGH");
  });
});
describe("simple pilot production projection", () => {
  it("keeps payment separate and derives production from tickets", () => {
    expect(simpleProductionStatus([])).toBe("NEW");
    expect(simpleProductionStatus(["NEW", "NEW"])).toBe("NEW");
    expect(simpleProductionStatus(["READY", "NEW"])).toBe("PREPARING");
    expect(simpleProductionStatus(["READY", "SERVED"])).toBe("READY");
    expect(simpleProductionStatus(["SERVED"])).toBe("COMPLETED");
    expect(simpleProductionStatus([], "SERVED")).toBe("COMPLETED");
  });
  it("keeps completed paid records in history and unpaid handoffs in Active", () => {
    const completed = {
      lifecycleStatus: "SERVED",
      paymentStatus: "PAID" as const,
    };
    expect(pilotOrderMatchesView(completed, "ACTIVE")).toBe(false);
    for (const view of ["TODAY", "PAID", "COMPLETED"] as const)
      expect(pilotOrderMatchesView(completed, view, true)).toBe(true);
    expect(
      pilotOrderMatchesView(
        { ...completed, paymentStatus: "PENDING_PAYMENT" },
        "ACTIVE",
      ),
    ).toBe(true);
    expect(
      pilotOrderMatchesView(
        { ...completed, lifecycleStatus: "REJECTED" },
        "ACTIVE",
      ),
    ).toBe(false);
    expect(
      pilotOrderMatchesView(
        { ...completed, lifecycleStatus: "REJECTED" },
        "TODAY",
      ),
    ).toBe(true);
  });
});
