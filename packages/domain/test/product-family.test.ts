import { describe, expect, it } from "vitest";

import {
  isProductSelectableInOnboarding,
  PRODUCT_CATALOG,
  PRODUCT_CODES,
} from "../src/index.js";

describe("FlowGastronomie product family", () => {
  it("keeps one canonical definition for every announced product", () => {
    expect(PRODUCT_CATALOG.map(({ code }) => code)).toEqual(PRODUCT_CODES);
    expect(new Set(PRODUCT_CATALOG.map(({ name }) => name)).size).toBe(
      PRODUCT_CATALOG.length,
    );
  });

  it("allows onboarding only into products that are actually active", () => {
    expect(isProductSelectableInOnboarding("RESTAURANT")).toBe(true);
    for (const code of PRODUCT_CODES.filter((code) => code !== "RESTAURANT")) {
      expect(isProductSelectableInOnboarding(code)).toBe(false);
    }
  });

  it("keeps DeliveryFlow explicitly later than the planned venue products", () => {
    expect(
      PRODUCT_CATALOG.find(({ code }) => code === "DELIVERY")?.status,
    ).toBe("LATER");
  });
});
