import { describe, expect, it } from "vitest";

import {
  MenuConfigurationInvalidError,
  assertProductMenuConfiguration,
  productMenuConfigurationIssues,
} from "../src/menu-configuration";

const translations = ["en", "de", "it", "sq"].map((locale) => ({
  locale: locale as "en" | "de" | "it" | "sq",
  name: `Name ${locale}`,
}));

describe("product menu configuration", () => {
  it("accepts a complete variant and modifier configuration", () => {
    expect(
      productMenuConfigurationIssues({
        basePriceMinor: 1200,
        variants: [
          {
            priceDeltaMinor: 0,
            sortOrder: 0,
            available: true,
            isDefault: true,
            translations,
          },
        ],
        modifierGroups: [
          {
            minSelect: 0,
            maxSelect: 1,
            sortOrder: 0,
            translations,
            options: [
              {
                priceDeltaMinor: 150,
                sortOrder: 0,
                available: true,
                translations,
              },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  it("requires exactly one default variant", () => {
    expect(() =>
      assertProductMenuConfiguration({
        basePriceMinor: 1200,
        variants: [
          {
            priceDeltaMinor: 0,
            sortOrder: 0,
            available: true,
            isDefault: false,
            translations,
          },
        ],
        modifierGroups: [],
      }),
    ).toThrow(MenuConfigurationInvalidError);
  });

  it("rejects impossible modifier selection limits", () => {
    expect(
      productMenuConfigurationIssues({
        basePriceMinor: 1200,
        variants: [],
        modifierGroups: [
          {
            minSelect: 2,
            maxSelect: 3,
            sortOrder: 0,
            translations,
            options: [
              {
                priceDeltaMinor: 0,
                sortOrder: 0,
                available: true,
                translations,
              },
            ],
          },
        ],
      }),
    ).toContain("MODIFIER_SELECTION_LIMITS_INVALID");
  });
});
