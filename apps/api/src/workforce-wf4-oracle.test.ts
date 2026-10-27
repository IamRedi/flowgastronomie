import { describe, it, expect } from "vitest";
import {
  configs,
  instant,
  intervalTotals,
  expectedMonth,
  expectedFollowingMonth,
  reconcile,
  type LedgerWorker,
} from "../../../tests/workforce-wf4/oracle.js";
import { runWorkforceMonth } from "../../../tests/workforce-wf4/engine.js";
const worker = (): LedgerWorker => ({
  key: "independent",
  contracts: [{ from: "2031-02-01", weeklyMinutes: 2400 }],
  planned: [],
  actual: [],
  leave: [],
  carryMinutes: 30,
});
describe("independent WF4 fixture oracle", () => {
  it("matches explicit calendar targets and never derives them from platform results", () => {
    const w = worker();
    expect(expectedMonth(w, configs[0]!).targetMs).toBe(10080 * 60000);
    w.endedOn = "2031-03-25";
    expect(expectedMonth(w, configs[0]!).targetMs).toBe(8160 * 60000);
    delete w.endedOn;
    w.contracts = [
      { from: "2031-02-01", weeklyMinutes: 1800 },
      { from: "2031-03-16", weeklyMinutes: 1500 },
    ];
    expect(expectedMonth(w, configs[0]!).targetMs).toBe(6900 * 60000);
    w.contracts = [{ from: "2031-02-01", weeklyMinutes: 2520 }];
    expect(expectedMonth(w, configs[1]!).targetMs).toBe(10920 * 60000);
  });
  it("has explicit spring and fall UTC fixtures, including folds and gap rejection", () => {
    const spring = {
      start: Date.parse("2031-03-29T21:00Z"),
      end: Date.parse("2031-03-30T04:00Z"),
      breaks: [
        {
          start: Date.parse("2031-03-30T00:00Z"),
          end: Date.parse("2031-03-30T00:30Z"),
          kind: "UNPAID" as const,
        },
      ],
      source: "spring",
    };
    expect(intervalTotals([spring], spring.start, spring.end)).toEqual({
      presence: 420 * 60000,
      paid: 0,
      unpaid: 30 * 60000,
      net: 390 * 60000,
    });
    expect(
      intervalTotals(
        [spring],
        instant("2031-03-30T00:00"),
        instant("2031-03-31T00:00"),
      ).net,
    ).toBe(270 * 60000);
    expect(instant("2031-10-26T04:00") - instant("2031-10-26T00:00")).toBe(
      300 * 60000,
    );
    expect(
      instant("2031-10-26T02:30", "later") -
        instant("2031-10-26T02:30", "earlier"),
    ).toBe(60 * 60000);
    expect(() => instant("2031-03-30T02:30")).toThrow("gap");
  });
  it("preserves exact month-boundary planned allocation and actual positioned breaks", () => {
    const w = worker();
    const start = instant("2031-03-31T22:00"),
      end = instant("2031-04-01T06:00");
    w.planned = [
      {
        id: "boundary",
        worker: 0,
        day: "2031-03-31",
        startsLocal: "2031-03-31T22:00",
        endsLocal: "2031-04-01T06:00",
        start,
        end,
        breakMinutes: 30,
        station: "KITCHEN",
      },
    ];
    w.actual = [
      {
        start,
        end,
        breaks: [
          {
            start: instant("2031-04-01T00:30"),
            end: instant("2031-04-01T01:00"),
            kind: "UNPAID",
          },
        ],
        source: "boundary",
      },
    ];
    const march = expectedMonth(w, configs[0]!);
    expect(march.plannedMs).toBe(112.5 * 60000);
    expect(march.actualMs).toBe(120 * 60000);
    expect(expectedMonth(w, configs[0]!, Infinity, "2031-04").actualMs).toBe(
      330 * 60000,
    );
    expect(() =>
      reconcile({ ...march, actualMs: 1 }, march, "worker venue date source"),
    ).toThrow("worker venue date source");
  });
  it("independently carries a dated-contract March balance into the complete April account and rejects corrupted carry", () => {
    const w = worker();
    w.contracts = [
      { from: "2031-02-01", weeklyMinutes: 1800 },
      { from: "2031-03-16", weeklyMinutes: 1500 },
    ];
    w.actual = [
      {
        start: instant("2031-03-28T09:00"),
        end: instant("2031-03-28T17:00"),
        breaks: [],
        source: "explicit-retroactive-fixture",
      },
    ];
    const caps = { positiveMinutes: null, negativeMinutes: null };
    const march = expectedMonth(w, configs[0]!);
    // 480 worked + 300 synthetic holiday credit - 6900 target + 30 opening.
    expect(march.balanceMs).toBe(-6090 * 60000);
    const april = expectedFollowingMonth(
      w,
      configs[0]!,
      "2031-03",
      "2031-04",
      caps,
    );
    expect(april.carryMs).toBe(-6090 * 60000);
    expect(april.targetMs).toBe(22 * 300 * 60000);
    expect(april.balanceMs).toBe(-12690 * 60000);
    const originalApril = structuredClone(april);
    w.actual[0]!.end += 15 * 60000;
    const compensated = expectedFollowingMonth(
      w,
      configs[0]!,
      "2031-03",
      "2031-04",
      caps,
    );
    expect(compensated.carryMs - april.carryMs).toBe(15 * 60000);
    expect(compensated.balanceMs - april.balanceMs).toBe(15 * 60000);
    expect(april).toEqual(originalApril);
    expect(() =>
      reconcile(
        { ...compensated, carryMs: april.carryMs },
        compensated,
        "April stale carry",
      ),
    ).toThrow("April stale carry");
    expect(() =>
      reconcile(
        { ...compensated, carryMs: compensated.carryMs + 1 },
        compensated,
        "April corrupt carry",
      ),
    ).toThrow("carryMs");
    expect(
      expectedFollowingMonth(w, configs[0]!, "2031-03", "2031-04", {
        positiveMinutes: 60,
        negativeMinutes: 120,
      }).carryMs,
    ).toBe(-120 * 60000);
    w.carryMinutes = 10000;
    expect(
      expectedFollowingMonth(w, configs[0]!, "2031-03", "2031-04", {
        positiveMinutes: 60,
        negativeMinutes: 120,
      }).carryMs,
    ).toBe(60 * 60000);
  });
  it("rejects remote and production fixtures before any business action", async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL =
      "postgresql://synthetic:unused@remote.invalid/test?schema=workforce_wf4_123";
    try {
      await expect(runWorkforceMonth({} as any, { now: 0 })).rejects.toThrow(
        "Isolated local",
      );
      const oldMode = process.env.NODE_ENV,
        oldFlag = process.env.WORKFORCE_WF4_GATE;
      process.env.DATABASE_URL =
        "postgresql://synthetic:unused@localhost/test?schema=workforce_wf4_123";
      process.env.NODE_ENV = "production";
      process.env.WORKFORCE_WF4_GATE = "true";
      try {
        await expect(runWorkforceMonth({} as any, { now: 0 })).rejects.toThrow(
          "Isolated local",
        );
      } finally {
        if (oldMode === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = oldMode;
        if (oldFlag === undefined) delete process.env.WORKFORCE_WF4_GATE;
        else process.env.WORKFORCE_WF4_GATE = oldFlag;
      }
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });
});
