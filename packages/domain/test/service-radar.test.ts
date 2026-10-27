import { describe, expect, it } from "vitest";

import { rankServiceSignals } from "../src/index.js";

describe("rankServiceSignals", () => {
  it("shows the oldest unacknowledged signal first", () => {
    const result = rankServiceSignals([
      {
        id: "new",
        tableLabel: "T8",
        type: "BILL_REQUEST",
        createdAt: new Date("2026-08-06T10:05:00Z"),
      },
      {
        id: "old",
        tableLabel: "T2",
        type: "WATER_REQUEST",
        createdAt: new Date("2026-08-06T10:00:00Z"),
      },
      {
        id: "done",
        tableLabel: "T4",
        type: "WAITER_CALL",
        createdAt: new Date("2026-08-06T09:00:00Z"),
        acknowledgedAt: new Date("2026-08-06T09:01:00Z"),
      },
    ]);

    expect(result.map((signal) => signal.id)).toEqual(["old", "new"]);
  });
});
