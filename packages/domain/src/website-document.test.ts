import { describe, expect, it } from "vitest";
import {
  legacyWebsiteDocument,
  websiteDocumentSchema,
  replaceWebsiteSectionCopy,
  documentTranslations,
} from "./website-document";
import { PLATFORM_LOCALES } from "./locale";
import { websitePublicationIssues } from "./venue-website";
const translations = PLATFORM_LOCALES.map((locale) => ({
  locale,
  heroTitle: "Venue",
  heroSubtitle: "Original",
  storyTitle: "About",
  storyBody: "Verified description",
  seoTitle: "Venue",
  seoDescription: "Description",
}));
describe("versioned website sections", () => {
  it("adapts legacy content without losing languages or modifying its source", () => {
    const before = structuredClone(translations);
    const doc = legacyWebsiteDocument(translations);
    expect(websiteDocumentSchema.parse(doc)).toEqual(doc);
    expect(documentTranslations(doc, translations)).toEqual(translations);
    expect(translations).toEqual(before);
  });
  it("changes exactly one section and locale, retaining media, visibility and order", () => {
    const doc = legacyWebsiteDocument(translations);
    doc.sections[1]!.media = [
      { assetId: "owned-media", alt: "Food", x: 20, y: 80 },
    ];
    doc.sections[2]!.visible = false;
    const next = replaceWebsiteSectionCopy(
      doc,
      "about",
      "de",
      { title: "Über uns", body: "Beschreibung" },
      null,
    );
    expect(next.sections[0]).toEqual(doc.sections[0]);
    expect(next.sections.slice(2)).toEqual(doc.sections.slice(2));
    expect(next.sections[1]!.media).toEqual(doc.sections[1]!.media);
    expect(next.sections[1]!.content.filter((c) => c.locale !== "de")).toEqual(
      doc.sections[1]!.content.filter((c) => c.locale !== "de"),
    );
    expect(() =>
      replaceWebsiteSectionCopy(
        doc,
        "unknown",
        "de",
        { title: "x", body: "x" },
        null,
      ),
    ).toThrow();
  });
  it("rejects duplicate IDs, duplicate singleton sections, missing languages and executable design parameters", () => {
    const doc = legacyWebsiteDocument(translations);
    expect(
      websiteDocumentSchema.safeParse({
        ...doc,
        sections: [...doc.sections, doc.sections[0]],
      }).success,
    ).toBe(false);
    expect(
      websiteDocumentSchema.safeParse({
        ...doc,
        sections: [{ ...doc.sections[0], html: "<script>alert(1)</script>" }],
      }).success,
    ).toBe(false);
    expect(
      websiteDocumentSchema.safeParse({
        ...doc,
        sections: [
          { ...doc.sections[0], content: [doc.sections[0]!.content[0]] },
        ],
      }).success,
    ).toBe(false);
    expect(
      websiteDocumentSchema.safeParse({
        ...doc,
        sections: [
          {
            ...doc.sections[0],
            media: [{ assetId: "x", alt: "x", x: 101, y: 0 }],
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("allows a minimal modular business without inventing public contact details; legacy requirements remain", () => {
    const input = {
      publicSlug: "synthetic-venue",
      primaryColor: "#17382f",
      accentColor: "#ed6b37",
      phone: null,
      contactEmail: null,
      address: null,
      translations,
    };
    expect(websitePublicationIssues(input)).toContain("CONTACT_REQUIRED");
    expect(
      websitePublicationIssues({
        ...input,
        document: legacyWebsiteDocument(translations),
      }),
    ).toEqual([]);
  });
});
