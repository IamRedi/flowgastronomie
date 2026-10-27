import type {
  CanonicalMediaReference,
  WebsiteDocument,
} from "@flowgastronomie/domain";
type VenueMedia = { role: string; media: CanonicalMediaReference };

/** Project approved canonical media into a new draft; never approve an asset. */
export function templateDraftMedia(
  document: WebsiteDocument,
  venue: VenueMedia[],
  name: string,
): WebsiteDocument {
  return {
    ...document,
    sections: document.sections.map((section) => {
      if (section.media.length || !["HERO", "GALLERY"].includes(section.type))
        return section;
      const approved = venue.filter(
        (row) =>
          row.role === (section.type === "HERO" ? "HERO" : "GALLERY") &&
          row.media.approvedForPublicUse,
      );
      return {
        ...section,
        media: approved
          .slice(0, section.type === "HERO" ? 1 : 8)
          .map(({ media }) => ({ assetId: media.id, alt: name, x: 50, y: 50 })),
      };
    }),
  };
}
export function approvedDraftMediaUrl(
  url: string | null,
  references: CanonicalMediaReference[],
) {
  if (!url?.startsWith("/v1/media/")) return url;
  return references.some(
    (media) => media.url === url && media.approvedForPublicUse,
  )
    ? url
    : null;
}
