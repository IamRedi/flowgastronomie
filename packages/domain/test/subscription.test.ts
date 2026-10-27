import { describe, expect, it } from "vitest";

import {
  entitlementsForPlan,
  PLAN_DEFINITIONS,
  planIncludesFeature,
} from "../src/index.js";

describe("subscription plans", () => {
  it("keeps the three public monthly prices stable", () => {
    expect(PLAN_DEFINITIONS.WEBSITE.monthlyPriceMinor).toBe(1900);
    expect(PLAN_DEFINITIONS.SMART_SERVICE.monthlyPriceMinor).toBe(3900);
    expect(PLAN_DEFINITIONS.RESTAURANT_PRO.monthlyPriceMinor).toBe(6900);
  });

  it("adds capabilities progressively without removing lower-plan features", () => {
    for (const feature of PLAN_DEFINITIONS.WEBSITE.features) {
      expect(planIncludesFeature("SMART_SERVICE", feature)).toBe(true);
      expect(planIncludesFeature("RESTAURANT_PRO", feature)).toBe(true);
    }
    for (const feature of PLAN_DEFINITIONS.SMART_SERVICE.features) {
      expect(planIncludesFeature("RESTAURANT_PRO", feature)).toBe(true);
    }
  });

  it("keeps ordering, stations, shifts, payments and reports in Pro", () => {
    for (const feature of [
      "GUEST_ORDERING",
      "ONLINE_ORDERING",
      "PRODUCTION_STATIONS",
      "STAFF_SHIFTS",
      "MANUAL_PAYMENTS",
      "REPORTING",
    ] as const) {
      expect(planIncludesFeature("RESTAURANT_PRO", feature)).toBe(true);
      expect(planIncludesFeature("SMART_SERVICE", feature)).toBe(false);
    }
  });

  it("creates explicit enabled and disabled entitlements", () => {
    const entitlements = entitlementsForPlan("SMART_SERVICE");
    expect(
      entitlements.find(({ featureKey }) => featureKey === "SERVICE_RADAR"),
    ).toMatchObject({ enabled: true });
    expect(
      entitlements.find(({ featureKey }) => featureKey === "MANUAL_PAYMENTS"),
    ).toMatchObject({ enabled: false });
  });
});
