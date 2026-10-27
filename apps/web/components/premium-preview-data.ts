import {
  premiumShowcase,
  type BusinessProfileId,
} from "@flowgastronomie/domain";
import type { Locale } from "../lib/i18n";
import type { VenueSiteData } from "./venue-site-view";
import { premiumCopy } from "./premium-copy";
export function premiumPreviewData(
  profile: BusinessProfileId,
  styleId: string,
  locale: Locale,
): VenueSiteData {
  const pack = premiumShowcase(profile);
  const style = pack.styles.find((s) => s.id === styleId) ?? pack.styles[0];
  const words = premiumCopy(locale);
  return {
    locale,
    publicSlug: "",
    venue: {
      name:
        profile === "GENERIC"
          ? {
              en: "Your business",
              de: "Dein Betrieb",
              it: "La tua attività",
              sq: "Biznesi yt",
            }[locale]
          : pack.name,
      currency: "EUR",
    },
    brand: {
      premiumStyleId: style.id,
      primaryColor: style.primaryColor,
      accentColor: style.accentColor,
      logoUrl: null,
      heroImageUrl:
        profile === "GENERIC"
          ? null
          : `/showcases/${profile.toLowerCase()}.webp`,
    },
    content: {
      heroTitle: pack.tagline[locale],
      heroSubtitle: pack.categories.length
        ? pack.categories.map((c) => c.translations[locale]).join(" · ")
        : words.storyBody,
      storyTitle: words.story,
      storyBody: pack.story[locale],
      seoTitle: pack.name,
      seoDescription: pack.tagline[locale],
    },
    contact: {
      phone: null,
      email: null,
      address: null,
      instagramUrl: null,
      facebookUrl: null,
      openingHours: [],
    },
    menu: pack.categories.map((c) => ({
      id: c.key,
      name: c.translations[locale],
      products: c.products.map((p) => ({
        id: p.key,
        name: p.name[locale],
        description: p.description[locale],
        priceMinor: p.priceMinor,
        currency: p.currency,
        available: false,
        ...(p.photoKey
          ? {
              media: {
                id: `sample:${p.photoKey}`,
                url: `/showcases/products/${p.photoKey}.webp`,
                source: "DEMO" as const,
                label: "SAMPLE",
                width: 640,
                height: 480,
                contentHash: "",
                approvedForPublicUse: false,
              },
            }
          : {}),
      })),
    })),
  };
}
