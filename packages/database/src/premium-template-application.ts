import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { normalizeCanonicalImage } from "./media-storage-adapter.js";
import {
  storeCanonicalMedia,
  assignCanonicalMedia,
} from "./canonical-media-repository.js";
import type { Prisma } from "@prisma/client";
import {
  PLATFORM_LOCALES,
  resolvePremiumSelection,
  type BusinessProfileId,
} from "@flowgastronomie/domain";

// Called only inside the canonical provisioner's fresh-business transaction.
// No existing venue/template reset path is exposed here.
export async function applyPremiumTemplate(
  tx: Prisma.TransactionClient,
  scope: { tenantId: string; venueId: string },
  profileId: BusinessProfileId,
  value: unknown,
  currency: string,
  actor: { userId: string; membershipId: string },
) {
  const { pack, style, selection } = resolvePremiumSelection(
    profileId,
    value,
    currency,
  );
  await tx.venueWebsite.update({
    where: { venueId: scope.venueId, tenantId: scope.tenantId },
    data: {
      premiumStyleId: style.id,
      primaryColor: style.primaryColor,
      accentColor: style.accentColor,
      status: "DRAFT",
      translations: {
        create: PLATFORM_LOCALES.map((locale) => ({
          ...scope,
          locale: locale.toUpperCase() as "EN" | "DE" | "IT" | "SQ",
          heroTitle: pack.tagline[locale],
          heroSubtitle: `SAMPLE · ${pack.categories.map((c) => c.translations[locale]).join(" · ") || pack.story[locale]}`,
          storyTitle: `SAMPLE · ${pack.name}`,
          storyBody: `SAMPLE · ${pack.story[locale]}`,
          seoTitle: "SAMPLE",
          seoDescription: pack.tagline[locale],
        })),
      },
    },
  });
  // Resolve the workspace package in both native ESM and Playwright's CJS
  // loader. Assets travel with the canonical database package.
  const assets = join(
    dirname(
      createRequire(resolve(process.cwd(), "package.json")).resolve(
        "@flowgastronomie/database",
      ),
    ),
    "../assets/showcases",
  );
  const mediaActor = { ...scope, ...actor, role: "OWNER" as const };
  if (profileId !== "GENERIC") {
    const manifest = JSON.parse(
      await readFile(join(assets, "sources.json"), "utf8"),
    ) as {
      profileId: string;
      file: string;
      source: string;
      author: string;
      licenseUrl: string;
    }[];
    const source = manifest.find((s) => s.profileId === profileId)!;
    const image = await normalizeCanonicalImage(
      await readFile(join(assets, source.file)),
    );
    const media = await storeCanonicalMedia(tx, mediaActor, {
      image,
      sourceKey: `premium:${profileId}:hero:v1`,
      provenance: {
        source: "DEMO",
        description: `${source.author}; ${source.source}; ${source.licenseUrl}; illustrative stock, not actual business photography.`,
      },
      approvedForPublicUse: false,
      confirmed: true,
    });
    await assignCanonicalMedia(tx, mediaActor, media.id, { venueRole: "HERO" });
  }
  if (!selection.includeSampleMenu) return;
  const productSources = JSON.parse(
    await readFile(join(assets, "products/sources.json"), "utf8"),
  ) as {
    recipeKey: string;
    file: string;
    source: string;
    author: string;
    licenseUrl: string;
    match: string;
  }[];
  const categories = await tx.menuCategory.findMany({
    where: scope,
    include: { translations: true },
  });
  for (const category of pack.categories) {
    const canonical = categories.find((c) =>
      c.translations.some(
        (t) => t.locale === "EN" && t.name === category.translations.en,
      ),
    );
    if (!canonical) throw new Error("Premium category was not provisioned");
    for (const [sortOrder, product] of category.products.entries()) {
      const createdProduct = await tx.product.create({
        data: {
          ...scope,
          categoryId: canonical.id,
          priceMinor: product.priceMinor,
          currency,
          station: product.station,
          sortOrder,
          variants: {
            create: product.variants.map((variant, sortOrder) => ({
              ...scope,
              sortOrder,
              priceDeltaMinor: variant.priceDeltaMinor,
              isDefault: variant.isDefault,
              available: false,
              translations: {
                create: PLATFORM_LOCALES.map((locale) => ({
                  locale: locale.toUpperCase() as "EN" | "DE" | "IT" | "SQ",
                  name: `SAMPLE \u00b7 ${variant.name[locale]}`,
                })),
              },
            })),
          },
          published: false,
          available: false,
          translations: {
            create: PLATFORM_LOCALES.map((locale) => ({
              ...scope,
              locale: locale.toUpperCase() as "EN" | "DE" | "IT" | "SQ",
              name: `SAMPLE · ${product.name[locale]}`,
              description: `SAMPLE · ${product.description[locale]}`,
            })),
          },
        },
      });
      if (product.photoKey) {
        const source = productSources.find(
          (s) => s.recipeKey === product.photoKey,
        );
        if (!source) throw new Error("Missing sample media provenance");
        const image = await normalizeCanonicalImage(
          await readFile(join(assets, "products", source.file)),
        );
        const media = await storeCanonicalMedia(tx, mediaActor, {
          image,
          sourceKey: `premium:product:${product.photoKey}:v1`,
          provenance: {
            source: "DEMO",
            description: `${source.author}; ${source.source}; ${source.licenseUrl}; ${source.match}; SAMPLE illustration, not owner photography.`,
          },
          approvedForPublicUse: false,
          confirmed: true,
        });
        await assignCanonicalMedia(tx, mediaActor, media.id, {
          productId: createdProduct.id,
        });
      }
    }
  }
}
