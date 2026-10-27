import { describe, expect, it } from "vitest";

import {
  isValidBillingCountryCode,
  normalizeBillingCountryCode,
  planChangeIssues,
} from "../src/billing";

describe("subscription billing rules", () => {
  it("accepts a different plan when no request is pending", () => {
    expect(
      planChangeIssues({
        currentPlan: "WEBSITE",
        requestedPlan: "SMART_SERVICE",
        hasPendingRequest: false,
      }),
    ).toEqual([]);
  });

  it("rejects same-plan and concurrent requests", () => {
    expect(
      planChangeIssues({
        currentPlan: "RESTAURANT_PRO",
        requestedPlan: "RESTAURANT_PRO",
        hasPendingRequest: true,
      }),
    ).toEqual(["SAME_PLAN", "REQUEST_ALREADY_PENDING"]);
  });

  it("normalizes ISO billing country codes", () => {
    expect(normalizeBillingCountryCode(" de ")).toBe("DE");
    expect(isValidBillingCountryCode("DE")).toBe(true);
    expect(isValidBillingCountryCode("DEU")).toBe(false);
  });
});
