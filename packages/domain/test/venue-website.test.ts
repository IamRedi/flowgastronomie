import { describe, expect, it } from "vitest";

import {
  isValidBrandColor,
  isValidPublicSiteSlug,
  isWithinOpeningHours,
  websitePublicationIssues,
  type WebsiteTranslation,
} from "../src/index.js";

const translations: WebsiteTranslation[] = ["en", "de", "it", "sq"].map(
  (locale) => ({
    locale: locale as WebsiteTranslation["locale"],
    heroTitle: `Hero ${locale}`,
    heroSubtitle: `Subtitle ${locale}`,
    storyTitle: `Story ${locale}`,
    storyBody: `Body ${locale}`,
    seoTitle: `SEO ${locale}`,
    seoDescription: `Description ${locale}`,
  }),
);

describe("venue website publication", () => {
  it("accepts safe colors and public slugs", () => {
    expect(isValidBrandColor("#17382f")).toBe(true);
    expect(isValidBrandColor("orange")).toBe(false);
    expect(isValidPublicSiteSlug("restaurant-olive")).toBe(true);
    expect(isValidPublicSiteSlug("Restaurant Olive")).toBe(false);
  });

  it("allows publication only when all four languages and contact exist", () => {
    expect(
      websitePublicationIssues({
        publicSlug: "restaurant-olive",
        primaryColor: "#17382f",
        accentColor: "#ed6b37",
        phone: "+49 30 123456",
        contactEmail: null,
        address: "Berlin",
        translations,
      }),
    ).toEqual([]);
  });

  it("reports incomplete content instead of silently publishing it", () => {
    expect(
      websitePublicationIssues({
        publicSlug: "Invalid slug",
        primaryColor: "green",
        accentColor: "#ed6b37",
        phone: null,
        contactEmail: null,
        address: null,
        translations: translations.slice(0, 3),
      }),
    ).toEqual([
      "INVALID_PUBLIC_SLUG",
      "INVALID_PRIMARY_COLOR",
      "CONTACT_REQUIRED",
      "TRANSLATIONS_INCOMPLETE",
    ]);
  });

  it("uses the venue timezone and supports hours that cross midnight", () => {
    const openingHours = [
      {
        day: "MONDAY" as const,
        closed: false,
        opensAt: "18:00",
        closesAt: "02:00",
      },
      {
        day: "TUESDAY" as const,
        closed: true,
        opensAt: "00:00",
        closesAt: "00:00",
      },
    ];
    expect(
      isWithinOpeningHours({
        at: new Date("2026-08-03T20:00:00Z"),
        timezone: "Europe/Berlin",
        openingHours,
      }),
    ).toBe(true);
    expect(
      isWithinOpeningHours({
        at: new Date("2026-08-03T13:00:00Z"),
        timezone: "Europe/Berlin",
        openingHours,
      }),
    ).toBe(false);
    expect(
      isWithinOpeningHours({
        at: new Date("2026-08-03T23:30:00Z"),
        timezone: "Europe/Berlin",
        openingHours,
      }),
    ).toBe(true);
  });
});
