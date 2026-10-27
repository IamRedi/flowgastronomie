import { describe, expect, it } from "vitest";
import {
  pickupAvailability,
  resolvePickupTime,
  PickupTimeUnavailableError,
  onlineProductionCanStart,
  normalizeOrderRecoveryPhone,
  resolveLegacyPickupTime,
  WEEKDAYS,
} from "../src/index";

const hours = WEEKDAYS.map((day) => ({
  day,
  closed: false,
  opensAt: "17:00",
  closesAt: "22:00",
}));
const input = {
  now: new Date("2026-10-05T16:00:00Z"),
  timezone: "Europe/Berlin",
  openingHours: hours,
  pickupLeadMinutes: 20,
};
describe("server-authoritative pickup timing", () => {
  it("resolves open-venue ASAP exactly and ignores a browser timestamp", () => {
    expect(
      resolvePickupTime({
        ...input,
        timingMode: "ASAP",
        requestedFor: new Date(0),
      }),
    ).toEqual({
      requestedFor: new Date("2026-10-05T16:20:00Z"),
      productionNotBefore: input.now,
    });
    const times = pickupAvailability(input);
    expect(times.slots[0]).toEqual({
      at: new Date("2026-10-05T16:30:00Z"),
      day: "2026-10-05",
      label: "18:30",
    });
  });
  it("open-venue ASAP may prepare immediately even between rounded minutes", () => {
    const now = new Date("2026-10-05T16:00:33Z");
    expect(
      resolvePickupTime({ ...input, now, timingMode: "ASAP" })
        .productionNotBefore,
    ).toEqual(now);
    expect(() =>
      resolveLegacyPickupTime({
        ...input,
        requestedFor: new Date("2026-10-05T16:05:00Z"),
      }),
    ).toThrow(PickupTimeUnavailableError);
  });
  it("uses next opening plus preparation time when closed, excluding closed days", () => {
    const available = pickupAvailability({
      ...input,
      now: new Date("2026-10-05T19:50:00Z"),
      openingHours: hours.map((h) => ({ ...h, closed: h.day === "TUESDAY" })),
    });
    expect(available.earliest).toEqual(new Date("2026-10-07T15:20:00Z"));
    expect(available.slots.some((s) => s.day === "2026-10-06")).toBe(false);
  });
  it("does not invent availability or a real venue's lead time", () => {
    expect(
      pickupAvailability({ ...input, pickupLeadMinutes: null })
        .unavailableReason,
    ).toBe("NOT_CONFIGURED");
    expect(
      pickupAvailability({
        ...input,
        openingHours: hours.map((h) => ({ ...h, closed: true })),
      }),
    ).toMatchObject({
      earliest: null,
      slots: [],
      unavailableReason: "NO_OPENING",
    });
  });
  it("scheduled times must be real offered slots after the lead window", () => {
    const at = new Date("2026-10-05T16:30:00Z");
    expect(
      resolvePickupTime({ ...input, timingMode: "SCHEDULED", requestedFor: at })
        .requestedFor,
    ).toEqual(at);
    for (const value of [
      "2026-10-05T15:45:00Z",
      "2026-10-05T16:15:00Z",
      "2026-10-05T16:31:00Z",
      "2026-10-05T21:00:00Z",
      "2026-10-20T16:30:00Z",
    ]) {
      expect(() =>
        resolvePickupTime({
          ...input,
          timingMode: "SCHEDULED",
          requestedFor: new Date(value),
        }),
      ).toThrow(PickupTimeUnavailableError);
    }
  });
  it("supports overnight opening and a closed following day", () => {
    const overnight = hours.map((h) => ({
      ...h,
      opensAt: "22:00",
      closesAt: "02:00",
      closed: h.day !== "MONDAY",
    }));
    expect(
      pickupAvailability({
        ...input,
        openingHours: overnight,
        now: new Date("2026-10-05T22:00:00Z"),
      }).earliest,
    ).toEqual(new Date("2026-10-05T22:20:00Z"));
  });
  it("uses venue dates and quarter hours in non-integer timezones", () => {
    const allDay = hours.map((h) => ({
      ...h,
      opensAt: "00:00",
      closesAt: "00:00",
    }));
    const available = pickupAvailability({
      ...input,
      timezone: "Asia/Kathmandu",
      openingHours: allDay,
      now: new Date("2026-10-05T18:20:00Z"),
    });
    expect(available.slots[0]).toEqual({
      at: new Date("2026-10-05T18:45:00Z"),
      day: "2026-10-06",
      label: "00:30",
    });
  });
  it("DST spring slots never invent the skipped hour", () => {
    const available = pickupAvailability({
      ...input,
      now: new Date("2026-03-28T23:00:00Z"),
      openingHours: hours.map((h) => ({
        ...h,
        opensAt: "00:00",
        closesAt: "05:00",
      })),
    });
    expect(
      available.slots
        .filter((s) => s.day === "2026-03-29")
        .some((s) => s.label.startsWith("02:")),
    ).toBe(false);
  });
  it("DST fall-back slots distinguish both valid local instants", () => {
    const available = pickupAvailability({
      ...input,
      now: new Date("2026-10-24T22:00:00Z"),
      openingHours: hours.map((h) => ({
        ...h,
        opensAt: "00:00",
        closesAt: "05:00",
      })),
    });
    expect(
      available.slots.filter(
        (s) => s.day === "2026-10-25" && s.label.startsWith("02:30"),
      ),
    ).toEqual([
      {
        at: new Date("2026-10-25T00:30:00Z"),
        day: "2026-10-25",
        label: "02:30 (GMT+2)",
      },
      {
        at: new Date("2026-10-25T01:30:00Z"),
        day: "2026-10-25",
        label: "02:30 (GMT+1)",
      },
    ]);
  });
  it("production remains gated until its persisted preparation boundary", () => {
    const boundary = new Date("2026-10-06T15:00:00Z");
    expect(onlineProductionCanStart(boundary, input.now)).toBe(false);
    expect(onlineProductionCanStart(boundary, boundary)).toBe(true);
  });
  it("phone normalization accepts formatting and international 00, never suffix matches", () => {
    expect(normalizeOrderRecoveryPhone("0049 (30) 123-456")).toBe(
      "+4930123456",
    );
    expect(normalizeOrderRecoveryPhone("+49 30 123456")).toBe("+4930123456");
    expect(normalizeOrderRecoveryPhone("123456")).not.toBe("+4930123456");
    expect(normalizeOrderRecoveryPhone("not-a-number")).toBeNull();
  });
});
