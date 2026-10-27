import { describe, it, expect } from "vitest";
import {
  generateLabIntents,
  labChannelTargets,
  labResumeArrivals,
  type LabCatalogItem,
} from "../src/lab-traffic";
const catalog: LabCatalogItem[] = [
  ...Array.from({ length: 5 }, (_, i) => ({
    key: "meal" + i,
    productId: "meal" + i,
    name: "TEST ONLY meal " + i,
    category: "MEAL" as const,
    priceMinor: 900 + i * 100,
    station: "KITCHEN" as const,
    variantId: "large" + i,
    variantDelta: 200,
    modifierId: "extra" + i,
    modifierDelta: 100,
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    key: "drink" + i,
    productId: "drink" + i,
    name: "TEST ONLY drink",
    category: "DRINK" as const,
    priceMinor: 200 + i * 50,
    station: "BAR" as const,
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    key: "side" + i,
    productId: "side" + i,
    name: "TEST ONLY side",
    category: "SIDE" as const,
    priceMinor: 300,
    station: "KITCHEN" as const,
  })),
];
describe("seeded lab traffic", () => {
  it("uses distinct normal mixes and caps without weakening the required browser coverage", () => {
    expect(
      labChannelTargets({
        version: 1,
        profile: "DE",
        level: "NORMAL",
        seed: 29,
        maxOrders: 160,
        browserOrders: 3,
      }),
    ).toEqual({ COUNTER: 35, STAFF_TABLE: 15, QR: 14, WEBSITE: 16 });
    expect(
      labChannelTargets({
        version: 1,
        profile: "AL",
        level: "NORMAL",
        seed: 29,
        maxOrders: 160,
        browserOrders: 3,
      }),
    ).toEqual({ COUNTER: 15, STAFF_TABLE: 48, QR: 25, WEBSITE: 12 });
    expect(() =>
      labChannelTargets({
        version: 1,
        profile: "DE",
        level: "LOW",
        seed: 1,
        maxOrders: 4,
        browserOrders: 3,
      }),
    ).toThrow();
  });
  it("is reproducible while varying quantities, baskets, notes, prices and provenance", () => {
    const c = {
      version: 1 as const,
      profile: "DE" as const,
      level: "NORMAL" as const,
      seed: 29,
      maxOrders: 160,
      browserOrders: 3,
    };
    const a = generateLabIntents(c, catalog);
    expect(a).toEqual(generateLabIntents(c, catalog));
    expect(a).not.toEqual(generateLabIntents({ ...c, seed: 30 }, catalog));
    expect(a).toHaveLength(80);
    expect(a.filter((i) => i.provenance === "WEBSITE_BROWSER")).toHaveLength(3);
    expect(new Set(a.map((i) => i.totalMinor)).size).toBeGreaterThan(12);
    expect(
      a.every(
        (i) =>
          i.totalMinor ===
          i.items.reduce((n, l) => n + l.unitMinor * l.quantity, 0),
      ),
    ).toBe(true);
  });
  it("marks missed arrivals instead of manufacturing historical orders", () => {
    expect(
      labResumeArrivals(
        [
          { dueAt: new Date(0), status: "PENDING" },
          { dueAt: new Date(2000), status: "PENDING" },
          { dueAt: new Date(0), status: "SUCCEEDED" },
        ],
        new Date(1000),
      ).map((r) => r.status),
    ).toEqual(["MISSED", "PENDING", "SUCCEEDED"]);
  });
});
