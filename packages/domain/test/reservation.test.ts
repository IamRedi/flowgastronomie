import { describe, expect, it } from "vitest";

import {
  assertReservationRequest,
  InvalidReservationInputError,
  InvalidReservationTransitionError,
  transitionReservation,
} from "../src/reservation";

describe("reservations", () => {
  it("allows only the confirmation-first lifecycle", () => {
    expect(transitionReservation("REQUESTED", "CONFIRMED")).toBe("CONFIRMED");
    expect(transitionReservation("CONFIRMED", "NO_SHOW")).toBe("NO_SHOW");
    expect(() => transitionReservation("REQUESTED", "SEATED")).toThrow(
      InvalidReservationTransitionError,
    );
    expect(() => transitionReservation("COMPLETED", "CANCELLED")).toThrow(
      InvalidReservationTransitionError,
    );
  });

  it("rejects past times and impossible party sizes", () => {
    const now = new Date("2026-08-10T10:00:00Z");
    expect(() =>
      assertReservationRequest({ requestedFor: now, now, partySize: 2 }),
    ).toThrow(InvalidReservationInputError);
    expect(() =>
      assertReservationRequest({
        requestedFor: new Date("2026-08-10T12:00:00Z"),
        now,
        partySize: 51,
      }),
    ).toThrow(InvalidReservationInputError);
  });
});
