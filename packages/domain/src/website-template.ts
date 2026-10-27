import { PLATFORM_LOCALES } from "./locale";
import { premiumShowcase } from "./premium-showcase";
import type { BusinessProfileId } from "./business-profile";
import {
  legacyWebsiteDocument,
  websiteDocumentSchema,
  type WebsiteDocument,
  type WebsiteSection,
} from "./website-document";
import type { WebsiteTranslation } from "./venue-website";

// Template selection changes presentation only. Sample catalog data never enters
// this document or any operational menu. Existing copy/media/provenance survive.
export function websiteTemplate(input: {
  profileId: BusinessProfileId;
  styleId: string;
  venueName: string;
  translations: WebsiteTranslation[];
  document?: WebsiteDocument | null;
}) {
  const style = premiumShowcase(input.profileId).styles.find(
    (s) => s.id === input.styleId,
  );
  if (!style) throw new Error("Style does not belong to this business profile");
  const existing = input.document ?? legacyWebsiteDocument(input.translations);
  const headings = {
    en: [
      "Welcome",
      "Explore our menu",
      "Our menu",
      "A closer look",
      "Find us",
      "Discover our selection and find your next favourite.",
    ],
    sq: [
      "Mirë se vini",
      "Zbulo menunë tonë",
      "Menuja jonë",
      "Një vështrim nga afër",
      "Na gjeni",
      "Zbulo përzgjedhjen tonë dhe gjej të preferuarën tënde.",
    ],
    de: [
      "Willkommen",
      "Unsere Speisekarte entdecken",
      "Unsere Speisekarte",
      "Ein näherer Blick",
      "Hier findest du uns",
      "Entdecke unsere Auswahl und finde deinen nächsten Favoriten.",
    ],
    it: [
      "Benvenuti",
      "Scopri il nostro menu",
      "Il nostro menu",
      "Uno sguardo da vicino",
      "Dove siamo",
      "Scopri la nostra selezione e trova il tuo prossimo preferito.",
    ],
  };
  const kinds: WebsiteSection["type"][] =
    style.layout === "URBAN"
      ? ["HERO", "MENU", "ABOUT", "GALLERY", "CONTACT"]
      : ["HERO", "ABOUT", "MENU", "GALLERY", "CONTACT"];
  const sections = input.document
    ? existing.sections
    : kinds.map(
        (type) =>
          existing.sections.find((s) => s.type === type) ?? {
            id: type.toLowerCase(),
            type,
            visible: true,
            media: [],
            generation: null,
            layout: "EDITORIAL" as const,
            content: PLATFORM_LOCALES.map((locale) => ({
              locale,
              title: "",
              body: "",
            })),
          },
      );
  const document = websiteDocumentSchema.parse({
    ...existing,
    typography: style.layout === "URBAN" ? "SANS" : "SERIF",
    sections: sections.map((s) => ({
      ...s,
      layout:
        s.type === "HERO"
          ? style.layout === "HERITAGE"
            ? "CENTERED"
            : style.layout === "URBAN"
              ? "EDITORIAL"
              : "SPLIT"
          : s.type === "ABOUT"
            ? "SPLIT"
            : "EDITORIAL",
      content: s.content.map((c) => {
        if (input.document) return c;
        const h = headings[c.locale];
        return {
          ...c,
          title:
            c.title ||
            (s.type === "HERO"
              ? input.venueName
              : s.type === "ABOUT"
                ? h[0]
                : s.type === "MENU"
                  ? h[2]
                  : s.type === "GALLERY"
                    ? h[3]
                    : h[4]),
          body: c.body || (["HERO", "ABOUT"].includes(s.type) ? h[5] : ""),
        };
      }),
    })),
  });
  return { document, style, designVersion: 2 as const };
}
