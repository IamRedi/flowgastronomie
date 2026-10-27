import { describe, expect, it } from "vitest";
import {
  assertOnlinePickupPayable,
  assertOnlinePickupHandoffPaid,
  cashChange,
  cashClosing,
  minorAmount,
  parseMinorInput,
  snapshotTax,
  taxTotals,
} from "./counter-sale";
import { hasStaffPermission } from "./staff-permissions";

describe("counter sale integer foundations", () => {
  it("allows counter payment only for ready online pickup", () => {
    expect(() => assertOnlinePickupPayable("PICKUP", "READY")).not.toThrow();
    for (const [mode, status] of [
      ["PICKUP", "ACCEPTED"],
      ["PICKUP", "PREPARING"],
      ["DELIVERY", "READY"],
    ])
      expect(() => assertOnlinePickupPayable(mode!, status!)).toThrow();
  });
  it("requires payment before online pickup handoff", () => {
    expect(() =>
      assertOnlinePickupHandoffPaid("PICKUP", "COMPLETED", false),
    ).toThrow();
    expect(() =>
      assertOnlinePickupHandoffPaid("PICKUP", "COMPLETED", true),
    ).not.toThrow();
    expect(() =>
      assertOnlinePickupHandoffPaid("DELIVERY", "COMPLETED", false),
    ).not.toThrow();
  });
  it("calculates tax included in gross with a configured fixture rate", () => {
    expect(snapshotTax("TEST_10", 1000, 1100, 1)).toEqual({
      taxCode: "TEST_10",
      rateBasisPoints: 1000,
      quantity: 1,
      grossUnitMinor: 1100,
      grossMinor: 1100,
      netMinor: 1000,
      taxMinor: 100,
    });
  });
  it("rounds half up once per line and preserves reconciliation", () => {
    expect(snapshotTax("TEST_100", 10000, 1, 1).netMinor).toBe(1);
    expect(snapshotTax("TEST_100", 10000, 1, 2).netMinor).toBe(1);
    for (let gross = 0; gross < 200; gross++) {
      const line = snapshotTax("TEST_18", 1800, gross, 3);
      expect(line.taxMinor + line.netMinor).toBe(line.grossMinor);
      expect(line).toEqual(snapshotTax("TEST_18", 1800, gross, 3));
    }
  });
  it("groups multiple rates/codes without losing integer totals", () => {
    const total = taxTotals([
      snapshotTax("A", 1000, 1100, 1),
      snapshotTax("B", 1800, 590, 1),
      snapshotTax("A", 1000, 1100, 1),
    ]);
    expect(total.grossMinor).toBe(2790);
    expect(total.netMinor).toBe(2500);
    expect(total.taxMinor).toBe(290);
    expect(total.breakdown).toHaveLength(2);
  });
  it("supports configured zero tax without confusing absent configuration with zero", () =>
    expect(snapshotTax("ZERO_TEST", 0, 500, 2).taxMinor).toBe(0));
  it.each([-1, 1.5, NaN, Infinity, 2_147_483_648])(
    "rejects invalid minor amount %s",
    (amount) => expect(() => minorAmount(amount)).toThrow(),
  );
  it.each([-1, 1.5, 10001])("rejects invalid tax rate %s", (rate) =>
    expect(() => snapshotTax("TEST", rate, 100, 1)).toThrow(),
  );
  it("rejects overflow and altered tax snapshots", () => {
    expect(() => snapshotTax("TEST", 1000, 2_147_483_647, 2)).toThrow();
    expect(() =>
      taxTotals([{ ...snapshotTax("TEST", 1000, 1100, 1), netMinor: 900 }]),
    ).toThrow();
  });
  it("calculates change and denies insufficient received cash", () => {
    expect(cashChange(1850, 2000)).toBe(150);
    expect(() => cashChange(1850, 1849)).toThrow(/less/);
  });
  it("derives closing expected cash and counted difference", () =>
    expect(cashClosing(10000, 1850, 11800)).toEqual({
      expectedCashMinor: 11850,
      countedCashMinor: 11800,
      differenceMinor: -50,
    }));
  it("parses decimal display inputs into integer minor units", () => {
    expect(parseMinorInput("20,00")).toBe(2000);
    expect(parseMinorInput("0.1")).toBe(10);
    expect(parseMinorInput("18.50")).toBe(1850);
    for (const bad of ["1e2", "-1", "1.234", "", "NaN"])
      expect(parseMinorInput(bad)).toBeNull();
  });
  it("limits register management to leadership and payments to authorized staff", () => {
    expect(hasStaffPermission("OWNER", "REGISTER_MANAGE")).toBe(true);
    expect(hasStaffPermission("MANAGER", "REGISTER_MANAGE")).toBe(true);
    expect(hasStaffPermission("WAITER", "REGISTER_MANAGE")).toBe(false);
    expect(hasStaffPermission("KITCHEN", "PAYMENT_RECORD")).toBe(false);
  });
});
