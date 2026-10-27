import { describe, expect, it } from "vitest";
import {
  businessProfileIds,
  businessProfileTemplateSchema,
  businessProfileDefaults,
} from "./business-profile";
import {
  premiumCatalog,
  premiumShowcase,
  premiumStyleSelectionSchema,
  resolvePremiumSelection,
} from "./premium-showcase";
describe("premium templates", () => {
  it("has one canonical pack per profile, three distinct styles and complete locales", () => {
    const catalog = premiumCatalog();
    expect(catalog).toHaveLength(10);
    expect(new Set(catalog.map((p) => p.profileId))).toEqual(
      new Set(businessProfileIds),
    );
    for (const pack of catalog) {
      expect(pack.styles).toHaveLength(3);
      expect(new Set(pack.styles.map((s) => s.layout)).size).toBe(3);
      expect(new Set(pack.styles.map((s) => s.id)).size).toBe(3);
      const products = pack.categories.flatMap((c) => c.products);
      if (pack.profileId !== "GENERIC") {
        expect(pack.categories.length).toBeGreaterThanOrEqual(5);
        expect(products.length).toBeGreaterThanOrEqual(12);
        expect(products.length).toBeLessThanOrEqual(24);
      }
      expect(new Set(products.map((p) => p.key)).size).toBe(products.length);
      for (const product of products) {
        expect(product.sample).toBe(true);
        expect(businessProfileDefaults(pack.profileId).stations).toContain(
          product.station,
        );
        expect(product.currency).toBe("EUR");
        expect(Number.isSafeInteger(product.priceMinor)).toBe(true);
        for (const locale of ["sq", "de", "en", "it"] as const) {
          expect(product.name[locale].length).toBeGreaterThan(1);
          expect(product.description[locale].length).toBeGreaterThan(3);
          expect(pack.tagline[locale].length).toBeGreaterThan(5);
        }
      }
    }
  });
  it("preserves legacy ids and isolated copies", () => {
    for (const id of ["BAR", "GENERIC", "DONER"] as const)
      expect(premiumShowcase(id).profileId).toBe(id);
    const a = premiumShowcase("CAFE");
    a.categories.splice(0);
    expect(premiumShowcase("CAFE").categories.length).toBeGreaterThan(0);
    expect(premiumShowcase("CAFE").name).toBe("Café Flora");
    expect(
      businessProfileTemplateSchema.parse({
        ...businessProfileDefaults("CAFE"),
        version: 2,
      }).version,
    ).toBe(2);
  });
  it("requires explicit confirmation, correct profile/version, and no implied currency conversion", () => {
    const selection = {
      styleId: "cafe-1",
      version: 1,
      confirmed: true,
      includeSampleMenu: true,
    };
    expect(resolvePremiumSelection("CAFE", selection, "EUR").style.id).toBe(
      "cafe-1",
    );
    expect(() => resolvePremiumSelection("BAR", selection, "EUR")).toThrow();
    expect(() => resolvePremiumSelection("CAFE", selection, "ALL")).toThrow();
    expect(
      resolvePremiumSelection(
        "CAFE",
        { ...selection, includeSampleMenu: false },
        "ALL",
      ).selection.includeSampleMenu,
    ).toBe(false);
    for (const invalid of [
      { confirmed: false },
      { version: 2 },
      { priceMinor: 1 },
      { publish: true },
      { tenantId: "other" },
    ])
      expect(
        premiumStyleSelectionSchema.safeParse({ ...selection, ...invalid })
          .success,
      ).toBe(false);
  });
});

it("reuses sample photographs only for the same named recipe and ingredients", () => {
  const products = premiumCatalog().flatMap((pack) =>
    pack.categories.flatMap((c) => c.products),
  );
  const signatures = new Map<string, string>();
  for (const product of products) {
    if (!product.photoKey) continue;
    const signature = `${product.name.en} / ${product.description.en}`;
    if (signatures.has(product.photoKey))
      expect(signature).toBe(signatures.get(product.photoKey));
    else signatures.set(product.photoKey, signature);
  }
  expect(
    products.some((p) => p.key === "hot-drinks-1" && p.photoKey === "coffee-1"),
  ).toBe(true);
});
