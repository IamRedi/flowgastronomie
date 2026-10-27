import { describe, expect, it } from "vitest";

import { businessDateForInstant, businessDayUtcRange } from "../src/index.js";

describe("venue business days", () => {
  it("uses the venue timezone when selecting the current date", () => {
    expect(
      businessDateForInstant(
        new Date("2026-08-07T22:30:00.000Z"),
        "Europe/Berlin",
      ),
    ).toBe("2026-08-08");
  });

  it("creates a summer Berlin day in UTC", () => {
    const range = businessDayUtcRange("2026-08-07", "Europe/Berlin");
    expect(range.startsAt.toISOString()).toBe("2026-08-06T22:00:00.000Z");
    expect(range.endsAt.toISOString()).toBe("2026-08-07T22:00:00.000Z");
  });

  it("handles the shorter daylight-saving transition day", () => {
    const range = businessDayUtcRange("2026-03-29", "Europe/Berlin");
    expect(range.startsAt.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(range.endsAt.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(range.endsAt.getTime() - range.startsAt.getTime()).toBe(
      23 * 60 * 60 * 1_000,
    );
  });

  it("rejects invalid calendar dates", () => {
    expect(() => businessDayUtcRange("2026-02-30", "UTC")).toThrow(RangeError);
  });
});
