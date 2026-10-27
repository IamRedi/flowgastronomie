import { websiteAiRequestSchema } from "./website-ai";
import { expect, it } from "vitest";
import { websiteTemplate } from "./website-template";
import { businessProfileIds } from "./business-profile";
import { premiumShowcase } from "./premium-showcase";
it("creates three distinct complete presentations for every profile without operational or demo facts", () => {
  for (const profileId of businessProfileIds) {
    const pack = premiumShowcase(profileId);
    const docs = pack.styles.map((style) =>
      websiteTemplate({
        profileId,
        styleId: style.id,
        venueName: "Synthetic venue",
        translations: [],
      }),
    );
    expect(new Set(docs.map((d) => JSON.stringify(d.document))).size).toBe(3);
    for (const d of docs) {
      expect(d.designVersion).toBe(2);
      expect(d.document.sections).toHaveLength(5);
      expect(
        d.document.sections.every(
          (s) => s.content.length === 4 && s.media.length === 0,
        ),
      ).toBe(true);
      expect(JSON.stringify(d.document)).not.toContain("priceMinor");
      expect(JSON.stringify(d.document)).not.toContain(pack.name);
    }
  }
});
it("preserves confirmed content, media, visibility and provenance when changing appearance", () => {
  const initial = websiteTemplate({
    profileId: "CAFE",
    styleId: "cafe-1",
    venueName: "Synthetic",
    translations: [],
  });
  initial.document.sections[0]!.content[0]!.title = "Confirmed title";
  initial.document.sections[0]!.media = [
    { assetId: "approved-photo", alt: "Photo", x: 30, y: 60 },
  ];
  initial.document.sections[1]!.visible = false;
  const next = websiteTemplate({
    profileId: "CAFE",
    styleId: "cafe-2",
    venueName: "Synthetic",
    translations: [],
    document: initial.document,
  });
  expect(next.document.sections.map(({ layout, ...s }) => s)).toEqual(
    initial.document.sections.map(({ layout, ...s }) => s),
  );
  expect(() =>
    websiteTemplate({
      profileId: "CAFE",
      styleId: "pizzeria-1",
      venueName: "Synthetic",
      translations: [],
    }),
  ).toThrow();
});

it("persists an explicit design-only intent only for whole-site proposals", () => {
  const input = {
    requestKey: "00000000-0000-4000-8000-000000000001",
    instruction: "Change design",
    locale: "en",
    expectedUpdatedAt: "2026-10-15T10:00:00.000Z",
    operation: "SITE",
    designOnly: true,
  };
  expect(websiteAiRequestSchema.parse(input).designOnly).toBe(true);
  expect(() =>
    websiteAiRequestSchema.parse({ ...input, operation: "SECTION" }),
  ).toThrow();
});
