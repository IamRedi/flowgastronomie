import { describe, expect, it } from "vitest";
import {
  pilotArea,
  pilotNavigation,
  pilotNavigationActive,
} from "./pilot-navigation";

describe("shared pilot navigation", () => {
  it("keeps locale changes and receipt subroutes in their primary area", () => {
    expect(pilotArea("/en/staff/pos", "en")).toBe("counter");
    expect(pilotArea("/sq/staff/pos", "sq")).toBe("counter");
    expect(pilotArea("/it/staff/receipts/r1", "it")).toBe("counter");
    expect(pilotArea("/app/de/overview", "de")).toBe("home");
    expect(pilotArea("/app/en/website/preview", "en")).toBe("website");
  });
  it("keeps every manager destination directly addressable, with Home first", () => {
    expect(pilotNavigation("en", "MANAGER").map((item) => item.key)).toEqual([
      "home",
      "counter",
      "orders",
      "kitchen",
      "menu",
      "website",
      "marketing",
      "workforce",
      "report",
      "settings",
    ]);
  });
  it("uses existing role permissions without exposing management to station staff", () => {
    expect(pilotNavigation("sq", "KITCHEN").map((item) => item.key)).toEqual([
      "home",
      "kitchen",
      "workforce",
    ]);
    expect(pilotNavigation("en", "BAR").map((item) => item.href)).toEqual([
      "/app/en/overview",
      "/en/staff/bar",
      "/en/staff/schedule",
    ]);
    expect(pilotNavigation("en", "WAITER").map((item) => item.key)).toEqual([
      "home",
      "counter",
      "orders",
      "workforce",
    ]);
  });
  it("selects receipt and online operational subpages", () => {
    expect(
      pilotNavigationActive(
        "counter",
        "/en/staff/pos",
        "/en/staff/receipts/receipt-1",
      ),
    ).toBe(true);
    expect(
      pilotNavigationActive(
        "orders",
        "/en/staff/orders",
        "/app/en/online-orders",
      ),
    ).toBe(true);
    expect(
      pilotNavigationActive(
        "settings",
        "/app/en/settings",
        "/app/en/online-orders/settings",
      ),
    ).toBe(true);
  });
  it("selects nested settings and website screens without prefix collisions", () => {
    expect(
      pilotNavigationActive(
        "settings",
        "/app/en/settings",
        "/app/en/settings/domain",
      ),
    ).toBe(true);
    expect(
      pilotNavigationActive("settings", "/app/en/settings", "/en/staff/setup"),
    ).toBe(true);
    expect(
      pilotNavigationActive(
        "website",
        "/app/en/website",
        "/app/en/website/preview",
      ),
    ).toBe(true);
    expect(
      pilotNavigationActive(
        "home",
        "/app/en/overview",
        "/app/en/overview-other",
      ),
    ).toBe(false);
  });
});
