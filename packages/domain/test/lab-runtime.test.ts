import { describe, it, expect } from "vitest";
import {
  assertLabControlTransition,
  labArrivalDecision,
  labWallInstant,
  labRuntimeConfigSchema,
  labRuntimePlan,
} from "../src/lab-runtime";
import type { LabIntent } from "../src/lab-traffic";
describe("wall-clock lab runtime", () => {
  it("assigns browser journeys only to future open arrivals without mutating original demand", () => {
    const intents: LabIntent[] = [0, 10, 20, 30].map((minute, position) => ({
      position,
      arrivalMinute: minute,
      channel: "WEBSITE",
      provenance: "WEBSITE_BROWSER",
      prepSeconds: 120,
      method: "CASH",
      cancel: false,
      totalMinor: 100,
      items: [
        {
          productId: "synthetic",
          quantity: 1,
          unitMinor: 100,
          station: "KITCHEN",
          name: "TEST ONLY",
          notes: "original note",
        },
      ],
    }));
    const config = labRuntimeConfigSchema.parse({
      version: 1,
      level: "NORMAL",
      seed: 29,
      cap: 80,
      mode: "WALL_CLOCK",
      windowSeconds: 90,
      maxActive: 8,
      graceSeconds: 300,
      weekendBusy: true,
    });
    const plan = labRuntimePlan(
      intents,
      new Date(0),
      new Date(1800000),
      new Date(600000),
      config,
    );
    expect(plan.map((p) => p.intent.provenance)).toEqual([
      "WEBSITE_API",
      "WEBSITE_BROWSER",
      "WEBSITE_BROWSER",
      "WEBSITE_API",
    ]);
    expect(plan.map((p) => p.dueAt.getTime())).toEqual([
      0, 600000, 1200000, 1800000,
    ]);
    expect(intents[1]!.items[0]!.notes).toBe("original note");
    expect(plan[1]!.intent.items[0]!.notes).toBeUndefined();
    expect(
      labRuntimePlan(
        intents,
        new Date(0),
        new Date(1800000),
        new Date(1800000),
        config,
      ).some((p) => p.intent.provenance === "WEBSITE_BROWSER"),
    ).toBe(false);
  });
  it("never substitutes a planned cancellation for a successful browser journey", () => {
    const intents: LabIntent[] = [10, 20, 30].map((minute, position) => ({
      position,
      arrivalMinute: minute,
      channel: "WEBSITE",
      provenance: "WEBSITE_API",
      prepSeconds: 120,
      method: "CASH",
      cancel: position === 0,
      totalMinor: 100,
      items: [
        {
          productId: "synthetic",
          quantity: 1,
          unitMinor: 100,
          station: "KITCHEN",
          name: "TEST ONLY",
        },
      ],
    }));
    const config = labRuntimeConfigSchema.parse({
      version: 1,
      level: "NORMAL",
      seed: 29,
      cap: 80,
      mode: "WALL_CLOCK",
      windowSeconds: 90,
      maxActive: 8,
      graceSeconds: 300,
      weekendBusy: true,
    });
    const plan = labRuntimePlan(
      intents,
      new Date(0),
      new Date(2400000),
      new Date(0),
      config,
    );
    expect(plan[0]!.intent.cancel).toBe(true);
    expect(plan[0]!.intent.provenance).toBe("WEBSITE_API");
    expect(
      plan.filter((p) => p.intent.provenance === "WEBSITE_BROWSER"),
    ).toHaveLength(2);
    expect(
      plan
        .filter((p) => p.intent.provenance === "WEBSITE_BROWSER")
        .every((p) => !p.intent.cancel),
    ).toBe(true);
  });
  it("uses venue-local opening through both DST boundaries", () => {
    expect(
      labWallInstant("2026-03-29", "10:00", "Europe/Berlin").toISOString(),
    ).toBe("2026-03-29T08:00:00.000Z");
    expect(
      labWallInstant("2026-10-25", "10:00", "Europe/Berlin").toISOString(),
    ).toBe("2026-10-25T09:00:00.000Z");
    expect(
      labWallInstant("2026-10-25", "10:00", "Europe/Tirane").toISOString(),
    ).toBe("2026-10-25T09:00:00.000Z");
  });
  it("recovers dispatched arrivals but skips missed undispatched demand", () => {
    expect(labArrivalDecision(new Date(600000), new Date(0), false, 300)).toBe(
      "MISSED",
    );
    expect(labArrivalDecision(new Date(600000), new Date(0), true, 300)).toBe(
      "RECOVER",
    );
    expect(labArrivalDecision(new Date(1000), new Date(0), false, 300)).toBe(
      "EXECUTE",
    );
  });
  it("requires review resolution before resume and bounds pressure", () => {
    expect(() =>
      assertLabControlTransition("NEEDS_REVIEW", "RUNNING"),
    ).toThrow();
    expect(() =>
      assertLabControlTransition("NEEDS_REVIEW", "PAUSED"),
    ).not.toThrow();
    expect(() =>
      assertLabControlTransition("STOPPED", "STOP_AFTER_DAY"),
    ).toThrow();
    expect(() =>
      labRuntimeConfigSchema.parse({
        version: 1,
        level: "NORMAL",
        seed: 29,
        cap: 301,
        mode: "WALL_CLOCK",
        windowSeconds: 90,
        maxActive: 8,
        graceSeconds: 300,
        weekendBusy: true,
      }),
    ).toThrow();
  });
});
