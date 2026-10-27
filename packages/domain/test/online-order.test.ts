import { describe, expect, it } from "vitest";

import {
  assertOnlineOrderRequest,
  canTransitionOnlineOrder,
  onlineOrderRequestIssues,
} from "../src/index";

const future = new Date("2026-08-10T18:00:00.000Z");
const now = new Date("2026-08-08T10:00:00.000Z");

describe("online order requests", () => {
  it("accepts a complete delivery request", () => {
    expect(() =>
      assertOnlineOrderRequest(
        {
          fulfillmentType: "DELIVERY",
          contact: { name: "Ada", phone: "+49123456" },
          requestedFor: future,
          deliveryAddress: {
            line1: "Market Street 1",
            postalCode: "80331",
            city: "Munich",
          },
        },
        now,
      ),
    ).not.toThrow();
  });

  it("requires address details for delivery and a guest count for catering", () => {
    expect(
      onlineOrderRequestIssues(
        {
          fulfillmentType: "DELIVERY",
          contact: { name: "Ada", phone: "+49123456" },
          requestedFor: future,
        },
        now,
      ),
    ).toContain("DELIVERY_ADDRESS_REQUIRED");
    expect(() =>
      assertOnlineOrderRequest(
        {
          fulfillmentType: "CATERING",
          contact: { name: "Ada", phone: "+49123456" },
          requestedFor: future,
          cateringGuestCount: 1,
        },
        now,
      ),
    ).toThrow("The online order request is invalid");
  });

  it("permits only explicit confirmation lifecycle transitions", () => {
    expect(
      canTransitionOnlineOrder("PENDING_CONFIRMATION", "ACCEPTED", "PICKUP"),
    ).toBe(true);
    expect(
      canTransitionOnlineOrder("READY", "OUT_FOR_DELIVERY", "PICKUP"),
    ).toBe(false);
    expect(
      canTransitionOnlineOrder("READY", "OUT_FOR_DELIVERY", "DELIVERY"),
    ).toBe(true);
    expect(canTransitionOnlineOrder("REJECTED", "ACCEPTED", "PICKUP")).toBe(
      false,
    );
  });
});
