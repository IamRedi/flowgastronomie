import {
  premiumShowcase,
  type BusinessProfileId,
  type WebsiteDocument,
  type CanonicalMediaReference,
} from "@flowgastronomie/domain";
import type { VenueSiteData } from "./venue-site-view";
import { premiumPreviewData } from "./premium-preview-data";
// Display-only decoration: no sample references are returned to the draft writer.
export function websiteTemplatePreview(
  site: VenueSiteData & { document: WebsiteDocument },
  profile: BusinessProfileId,
) {
  const preview = premiumPreviewData(
      profile,
      site.brand.premiumStyleId ?? "",
      site.locale,
    ),
    pack = premiumShowcase(profile);
  const demo = site.menu.every((c) => !c.products.length);
  const media = [...(site.sectionMedia ?? [])];
  const illustrations = pack.categories
    .flatMap((c) => c.products)
    .filter((p) => p.photoKey)
    .slice(0, 4);
  const document = {
    ...site.document,
    sections: site.document.sections.map((s) => {
      if (s.media.length || !["HERO", "ABOUT", "GALLERY"].includes(s.type))
        return s;
      const paths =
        s.type === "HERO"
          ? [preview.brand.heroImageUrl]
          : s.type === "GALLERY"
            ? illustrations
                .slice(0, 3)
                .map((p) => `/showcases/products/${p.photoKey}.webp`)
            : illustrations
                .slice(-1)
                .map((p) => `/showcases/products/${p.photoKey}.webp`);
      return {
        ...s,
        media: paths
          .filter((url): url is string => !!url)
          .map((url, i) => {
            const id = `demo:${s.id}:${i}`;
            media.push({
              id,
              url,
              source: "DEMO",
              label: "DEMO",
              width: 1200,
              height: 900,
              contentHash: "",
              approvedForPublicUse: false,
            } as CanonicalMediaReference);
            return {
              assetId: id,
              alt: s.content.find((c) => c.locale === site.locale)?.title ?? "",
              x: 50,
              y: 50,
            };
          }),
      };
    }),
  };
  return {
    site: {
      ...site,
      demoMenu: demo,
      document,
      sectionMedia: media,
      menu: demo ? preview.menu : site.menu,
    },
    demo,
    illustrative: document.sections.some((s) =>
      s.media.some((m) => m.assetId.startsWith("demo:")),
    ),
  };
}
