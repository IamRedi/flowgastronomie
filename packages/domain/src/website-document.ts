import { z } from "zod";
import { PLATFORM_LOCALES, type PlatformLocale } from "./locale";
import { premiumStyleIdSchema } from "./premium-showcase";
import type { WebsiteTranslation } from "./venue-website";

export const websiteSectionKinds = [
  "HERO",
  "ABOUT",
  "MENU",
  "GALLERY",
  "CONTACT",
] as const;
export const aiTextActions = [
  "WRITE",
  "IMPROVE",
  "SHORTEN",
  "EXPAND",
  "TONE",
  "TRANSLATE",
  "REGENERATE",
] as const;
export const sectionCopySchema = z.strictObject({
  locale: z.enum(PLATFORM_LOCALES),
  title: z.string().trim().max(120),
  body: z.string().trim().max(2000),
});
const copies = z
  .array(sectionCopySchema)
  .length(4)
  .refine(
    (rows) => new Set(rows.map((r) => r.locale)).size === 4,
    "Every language must appear exactly once",
  );
export const websiteSectionSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  type: z.enum(websiteSectionKinds),
  visible: z.boolean(),
  layout: z.enum(["SPLIT", "CENTERED", "EDITORIAL"]),
  content: copies,
  media: z
    .array(
      z.strictObject({
        assetId: z.string().min(1).max(128),
        alt: z.string().trim().max(180),
        x: z.number().min(0).max(100),
        y: z.number().min(0).max(100),
      }),
    )
    .max(8),
  generation: z
    .strictObject({
      proposalId: z.string().min(1).max(128),
      provider: z.string().max(80),
      model: z.string().max(100),
      approved: z.boolean(),
    })
    .nullable(),
});
export const websiteDocumentSchema = z
  .strictObject({
    version: z.literal(1),
    typography: z.enum(["SERIF", "SANS"]),
    sections: z.array(websiteSectionSchema).min(1).max(8),
  })
  .superRefine((doc, ctx) => {
    if (new Set(doc.sections.map((s) => s.id)).size !== doc.sections.length)
      ctx.addIssue({
        code: "custom",
        message: "Section identities must be unique",
      });
    if (
      doc.sections.some(
        (s) => s.type === "HERO" && s.content.some((c) => c.body.length > 280),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Hero subtitle exceeds 280 characters",
      });
    for (const kind of ["HERO", "MENU", "CONTACT"] as const)
      if (doc.sections.filter((s) => s.type === kind).length > 1)
        ctx.addIssue({
          code: "custom",
          message: `Only one ${kind} section is allowed`,
        });
  });
export type WebsiteDocument = z.infer<typeof websiteDocumentSchema>;
export type WebsiteSection = z.infer<typeof websiteSectionSchema>;

// The provider cannot return URLs, executable markup, operational facts or prices.
export const websitePlanSchema = z.strictObject({
  styleId: premiumStyleIdSchema,
  typography: z.enum(["SERIF", "SANS"]),
  sections: z
    .array(
      z.strictObject({
        type: z.enum(websiteSectionKinds),
        layout: z.enum(["SPLIT", "CENTERED", "EDITORIAL"]),
        content: copies,
      }),
    )
    .min(1)
    .max(8)
    .refine(
      (rows) =>
        new Set(rows.map((s) => s.type)).size === rows.length &&
        rows.some((s) => s.type === "HERO") &&
        rows.some((s) => s.type === "ABOUT"),
      "Use unique sections, including HERO and ABOUT",
    )
    .refine(
      (rows) =>
        rows.every(
          (s) =>
            s.type !== "HERO" || s.content.every((c) => c.body.length <= 280),
        ),
      "Hero subtitle exceeds 280 characters",
    ),
  seo: z
    .array(
      z.strictObject({
        locale: z.enum(PLATFORM_LOCALES),
        title: z.string().trim().min(1).max(70),
        description: z.string().trim().min(1).max(180),
      }),
    )
    .length(4)
    .refine((v) => new Set(v.map((r) => r.locale)).size === 4),
});
export type WebsitePlan = z.infer<typeof websitePlanSchema>;

export function legacyWebsiteDocument(
  translations: WebsiteTranslation[],
): WebsiteDocument {
  return {
    version: 1,
    typography: "SERIF",
    sections: websiteSectionKinds
      .filter((kind) => kind !== "GALLERY")
      .map((type) => ({
        id: type.toLowerCase(),
        type,
        visible: true,
        layout: type === "HERO" ? "SPLIT" : "EDITORIAL",
        media: [],
        generation: null,
        content: PLATFORM_LOCALES.map((locale) => {
          const t = translations.find((row) => row.locale === locale);
          return {
            locale,
            title:
              type === "HERO"
                ? (t?.heroTitle ?? "")
                : type === "ABOUT"
                  ? (t?.storyTitle ?? "")
                  : "",
            body:
              type === "HERO"
                ? (t?.heroSubtitle ?? "")
                : type === "ABOUT"
                  ? (t?.storyBody ?? "")
                  : "",
          };
        }),
      })),
  };
}

// A granular action replaces exactly one locale in one section, preserving order,
// media, other languages and the rest of the website.
export function replaceWebsiteSectionCopy(
  doc: WebsiteDocument,
  id: string,
  locale: PlatformLocale,
  copy: { title: string; body: string },
  generation: WebsiteSection["generation"],
): WebsiteDocument {
  if (!doc.sections.some((s) => s.id === id))
    throw new Error("Section not found");
  return websiteDocumentSchema.parse({
    ...doc,
    sections: doc.sections.map((s) =>
      s.id === id
        ? {
            ...s,
            generation,
            content: s.content.map((c) =>
              c.locale === locale ? { ...c, ...copy } : c,
            ),
          }
        : s,
    ),
  });
}

export function documentTranslations(
  doc: WebsiteDocument,
  previous: WebsiteTranslation[],
): WebsiteTranslation[] {
  return previous.map((t) => {
    const hero = doc.sections
      .find((s) => s.type === "HERO")
      ?.content.find((c) => c.locale === t.locale);
    const about = doc.sections
      .find((s) => s.type === "ABOUT")
      ?.content.find((c) => c.locale === t.locale);
    return {
      ...t,
      ...(hero
        ? { heroTitle: hero.title, heroSubtitle: hero.body.slice(0, 280) }
        : {}),
      ...(about ? { storyTitle: about.title, storyBody: about.body } : {}),
    };
  });
}
