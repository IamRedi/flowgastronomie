import { describe, expect, it } from "vitest";

import {
  assertGuestActionAllowed,
  canPerformGuestAction,
  GuestActionNotAllowedError,
  initialOrderStatus,
} from "../src/index.js";

describe("guest service policy", () => {
  it("allows only browsing in menu-only mode", () => {
    expect(canPerformGuestAction("MENU_ONLY", "ORDER")).toBe(false);
    expect(canPerformGuestAction("MENU_ONLY", "WAITER_CALL")).toBe(false);
  });

  it("allows service requests but not orders in call-and-request mode", () => {
    expect(canPerformGuestAction("CALL_AND_REQUEST", "BILL_REQUEST")).toBe(
      true,
    );
    expect(canPerformGuestAction("CALL_AND_REQUEST", "ORDER")).toBe(false);
  });

  it("starts staff-confirmed orders as new", () => {
    expect(initialOrderStatus("ORDER_AND_CONFIRM")).toBe("NEW");
  });

  it("starts self-service orders as accepted", () => {
    expect(initialOrderStatus("SELF_ORDER")).toBe("ACCEPTED");
    expect(initialOrderStatus("BAR")).toBe("ACCEPTED");
  });

  it("raises a domain error for a forbidden action", () => {
    expect(() => assertGuestActionAllowed("TAKEAWAY", "WAITER_CALL")).toThrow(
      GuestActionNotAllowedError,
    );
  });
});
