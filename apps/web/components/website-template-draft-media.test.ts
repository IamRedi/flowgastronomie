import { describe, expect, it } from "vitest";
import {
  legacyWebsiteDocument,
  type CanonicalMediaReference,
} from "@flowgastronomie/domain";
import {
  templateDraftMedia,
  approvedDraftMediaUrl,
} from "./website-template-draft-media";
const media = (id: string, approved: boolean): CanonicalMediaReference => ({
  id,
  url: `/v1/media/${id}`,
  source: approved ? "UPLOAD" : "DEMO",
  label: null,
  width: 100,
  height: 100,
  contentHash: "a".repeat(64),
  approvedForPublicUse: approved,
});
describe("template draft media approval boundary", () => {
  it("keeps private sample assets out of new draft references without changing their approval", () => {
    const privatePhoto = media("private-sample", false),
      approved = media("approved-owner", true);
    const doc = legacyWebsiteDocument(
      ["en", "de", "it", "sq"].map((locale) => ({
        locale: locale as "en" | "de" | "it" | "sq",
        heroTitle: "Fixture",
        heroSubtitle: "",
        storyTitle: "",
        storyBody: "",
        seoTitle: "",
        seoDescription: "",
      })),
    );
    const result = templateDraftMedia(
      doc,
      [
        { role: "HERO", media: privatePhoto },
        { role: "HERO", media: approved },
        { role: "GALLERY", media: privatePhoto },
      ],
      "Fixture",
    );
    expect(
      result.sections
        .find((s) => s.type === "HERO")
        ?.media.map((m) => m.assetId),
    ).toEqual([approved.id]);
    expect(
      result.sections
        .flatMap((s) => s.media)
        .some((m) => m.assetId === privatePhoto.id),
    ).toBe(false);
    expect(doc.sections.flatMap((s) => s.media)).toEqual([]);
    expect(privatePhoto.approvedForPublicUse).toBe(false);
  });
  it("retains only approved owned canonical legacy URLs and preserves ordinary legacy URLs", () => {
    const privatePhoto = media("private", false),
      approved = media("approved", true);
    expect(
      approvedDraftMediaUrl(privatePhoto.url, [privatePhoto, approved]),
    ).toBeNull();
    expect(
      approvedDraftMediaUrl("/v1/media/other-business", [approved]),
    ).toBeNull();
    expect(approvedDraftMediaUrl(approved.url, [approved])).toBe(approved.url);
    expect(
      approvedDraftMediaUrl("https://example.invalid/legacy.png", []),
    ).toBe("https://example.invalid/legacy.png");
  });
});
