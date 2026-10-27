import { expect, it } from "vitest";
import {
  businessProfileCatalog,
  assertBusinessProvisionKind,
  businessProfileDefaults,
  businessProfileTemplateSchema,
  businessIdentityLabel,
} from "./business-profile";
it("validates all ten versioned blueprints deterministically without tenant data", () => {
  const first = businessProfileCatalog();
  expect(first).toHaveLength(10);
  expect(
    first.map((value) => businessProfileTemplateSchema.parse(value)),
  ).toEqual(businessProfileCatalog());
  for (const profile of first) {
    expect(new Set(profile.categories.map((c) => c.key)).size).toBe(
      profile.categories.length,
    );
    expect(profile.version).toBe(3);
    expect(
      businessProfileTemplateSchema.safeParse({ ...profile, orders: [] })
        .success,
    ).toBe(false);
    expect(
      businessProfileTemplateSchema.safeParse({
        ...profile,
        tenantId: "copied",
      }).success,
    ).toBe(false);
  }
});
it("applies independent editable/skippable defaults without mutating the catalog", () => {
  const first = businessProfileDefaults("PIZZERIA");
  const second = businessProfileDefaults("PIZZERIA");
  expect(first).toEqual(second);
  first.categories[0]!.translations.sq = "Custom";
  expect(second.categories[0]!.translations.sq).toBe("Pica");
  expect(businessProfileDefaults("PIZZERIA", false).categories).toEqual([]);
  expect(businessProfileDefaults("GENERIC").categories).toEqual([]);
  expect(businessProfileDefaults("DONER").modifiers).toContain("Sauce");
});
it("requires complete localized categories with stable keys across every profile", () => {
  for (const profile of businessProfileCatalog()) {
    for (const category of profile.categories) {
      expect(Object.keys(category.translations)).toEqual([
        "en",
        "de",
        "it",
        "sq",
      ]);
      // Shared culinary words can coincide, but never copy English to all locales.
      expect(
        new Set(Object.values(category.translations)).size,
      ).toBeGreaterThan(1);
      for (const locale of ["en", "de", "it", "sq"] as const) {
        for (const invalid of [undefined, " "]) {
          expect(
            businessProfileTemplateSchema.safeParse({
              ...profile,
              categories: [
                {
                  ...category,
                  translations: { ...category.translations, [locale]: invalid },
                },
              ],
            }).success,
          ).toBe(false);
        }
      }
    }
  }
  expect(
    businessProfileDefaults("PIZZERIA").categories.find(
      (category) => category.key === "drinks",
    )?.translations,
  ).toEqual({
    en: "Drinks",
    de: "Getränke",
    it: "Bevande",
    sq: "Pije",
  });
  expect(
    businessProfileDefaults("BAKERY").categories.find(
      (category) => category.key === "bread",
    )?.translations,
  ).toEqual({
    en: "Bread",
    de: "Brot",
    it: "Pane",
    sq: "Bukë",
  });
});
it("distinguishes synthetic demos, local pilots and real businesses", () => {
  expect(businessIdentityLabel("DEMO")).toBe("DEMO");
  expect(businessIdentityLabel("LOCAL_PILOT")).toBe("LOCAL PILOT");
  expect(businessIdentityLabel("LEGACY_CI")).toBe("LEGACY CI FIXTURE");
  expect(businessIdentityLabel("REAL")).toBeNull();
});

it("allows fresh real businesses and synthetic fixtures but rejects legacy pilot creation", () => {
  for (const kind of ["REAL", "DEMO", "LEGACY_CI"] as const)
    expect(() => assertBusinessProvisionKind(kind)).not.toThrow();
  expect(() => assertBusinessProvisionKind("LOCAL_PILOT")).toThrow("retired");
  expect(businessIdentityLabel("LOCAL_PILOT")).toBe("LOCAL PILOT");
});
