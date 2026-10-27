import { createHash } from "node:crypto";

import {
  Locale,
  type StationType,
  type ServiceMode as PrismaServiceMode,
} from "@prisma/client";
import {
  resolveServiceMode,
  type AllergenCode,
  type PlatformLocale,
  type PublicMenu,
  type ServiceMode,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import { canonicalMediaRepository } from "./canonical-media-repository.js";
import type { CanonicalMediaReference } from "@flowgastronomie/domain";

type Translation = {
  locale: Locale;
  name: string;
  description?: string | null;
};

type MenuProductSource = {
  id: string;
  priceMinor: number;
  currency: string;
  available: boolean;
  station: StationType;
  translations: Translation[];
  allergens: Array<{ allergen: AllergenCode }>;
  variants: Array<{
    id: string;
    priceDeltaMinor: number;
    available: boolean;
    isDefault: boolean;
    translations: Translation[];
  }>;
  modifierGroups: Array<{
    id: string;
    minSelect: number;
    maxSelect: number;
    translations: Translation[];
    options: Array<{
      id: string;
      priceDeltaMinor: number;
      available: boolean;
      translations: Translation[];
    }>;
  }>;
};

type MenuCategorySource = {
  id: string;
  translations: Translation[];
  products: MenuProductSource[];
};

/**
 * Maps published menu records into the ordering shape with stable ids so the
 * public guest menu and the staff POS menu stay one server-owned contract.
 */
export function mapPublishedMenuCategories(
  categories: MenuCategorySource[],
  requestedLocale: Locale,
  fallbackLocale: Locale,
  media: Map<string, CanonicalMediaReference> = new Map(),
): PublicMenu["categories"] {
  return categories.flatMap((category) => {
    const translation = selectTranslation(
      category.translations,
      requestedLocale,
      fallbackLocale,
    );

    if (!translation) return [];

    return [
      {
        id: category.id,
        name: translation.name,
        products: category.products.flatMap((product) => {
          const productTranslation = selectTranslation(
            product.translations,
            requestedLocale,
            fallbackLocale,
          );

          if (!productTranslation) return [];

          return [
            {
              id: product.id,
              ...(media.has(product.id)
                ? { media: media.get(product.id)! }
                : {}),
              name: productTranslation.name,
              description: productTranslation.description ?? null,
              priceMinor: product.priceMinor,
              currency: product.currency,
              available: product.available,
              station: product.station,
              allergens: product.allergens.map((entry) => entry.allergen),
              variants: product.variants.flatMap((variant) => {
                const variantTranslation = selectTranslation(
                  variant.translations,
                  requestedLocale,
                  fallbackLocale,
                );
                return variantTranslation
                  ? [
                      {
                        id: variant.id,
                        name: variantTranslation.name,
                        priceDeltaMinor: variant.priceDeltaMinor,
                        available: variant.available,
                        isDefault: variant.isDefault,
                      },
                    ]
                  : [];
              }),
              modifierGroups: product.modifierGroups.flatMap((group) => {
                const groupTranslation = selectTranslation(
                  group.translations,
                  requestedLocale,
                  fallbackLocale,
                );
                if (!groupTranslation) return [];
                return [
                  {
                    id: group.id,
                    name: groupTranslation.name,
                    minSelect: group.minSelect,
                    maxSelect: group.maxSelect,
                    options: group.options.flatMap((option) => {
                      const optionTranslation = selectTranslation(
                        option.translations,
                        requestedLocale,
                        fallbackLocale,
                      );
                      return optionTranslation
                        ? [
                            {
                              id: option.id,
                              name: optionTranslation.name,
                              priceDeltaMinor: option.priceDeltaMinor,
                              available: option.available,
                            },
                          ]
                        : [];
                    }),
                  },
                ];
              }),
            },
          ];
        }),
      },
    ];
  });
}

export type PublicMenuRepository = {
  findByQrToken(
    qrToken: string,
    locale: PlatformLocale,
  ): Promise<PublicMenu | null>;
};

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashQrToken(qrToken: string): string {
  return hashOpaqueToken(qrToken);
}

const prismaLocales: Record<PlatformLocale, Locale> = {
  en: Locale.EN,
  de: Locale.DE,
  it: Locale.IT,
  sq: Locale.SQ,
};

const platformLocales: Record<Locale, PlatformLocale> = {
  EN: "en",
  DE: "de",
  IT: "it",
  SQ: "sq",
};

function selectTranslation<T extends Translation>(
  translations: readonly T[],
  requestedLocale: Locale,
  fallbackLocale: Locale,
): T | undefined {
  return (
    translations.find(
      (translation) => translation.locale === requestedLocale,
    ) ??
    translations.find((translation) => translation.locale === fallbackLocale)
  );
}

function asDomainServiceMode(mode: PrismaServiceMode): ServiceMode {
  return mode;
}

export const publicMenuRepository: PublicMenuRepository = {
  async findByQrToken(qrToken, requestedPlatformLocale) {
    const requestedLocale = prismaLocales[requestedPlatformLocale];
    const table = await prisma.diningTable.findUnique({
      where: { qrTokenHash: hashQrToken(qrToken) },
      include: {
        area: true,
        venue: {
          include: {
            categories: {
              where: { published: true },
              orderBy: { sortOrder: "asc" },
              include: {
                translations: true,
                products: {
                  where: { published: true, archivedAt: null },
                  orderBy: { sortOrder: "asc" },
                  include: {
                    translations: true,
                    allergens: true,
                    variants: {
                      orderBy: { sortOrder: "asc" },
                      include: { translations: true },
                    },
                    modifierGroups: {
                      orderBy: { sortOrder: "asc" },
                      include: {
                        translations: true,
                        options: {
                          orderBy: { sortOrder: "asc" },
                          include: { translations: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!table || table.qrRevokedAt) return null;

    const fallbackLocale = table.venue.defaultLocale;
    const effectiveLocale = platformLocales[requestedLocale];
    const serviceMode = resolveServiceMode({
      venueDefault: asDomainServiceMode(table.venue.defaultServiceMode),
      ...(table.area?.serviceModeOverride
        ? {
            areaOverride: {
              active: true,
              mode: asDomainServiceMode(table.area.serviceModeOverride),
            },
          }
        : {}),
      ...(table.serviceModeOverride
        ? {
            tableOverride: {
              active: true,
              mode: asDomainServiceMode(table.serviceModeOverride),
            },
          }
        : {}),
    });

    const canonical = await canonicalMediaRepository.resolve(
      { tenantId: table.tenantId, venueId: table.venueId },
      true,
    );
    const categories = mapPublishedMenuCategories(
      table.venue.categories,
      requestedLocale,
      fallbackLocale,
      new Map(canonical.products.map((row) => [row.productId, row.media])),
    );

    return {
      locale: effectiveLocale,
      venue: {
        name: table.venue.name,
        slug: table.venue.slug,
        currency: table.venue.currency,
      },
      table: {
        label: table.label,
        area: table.area?.name ?? null,
        serviceMode,
      },
      categories,
    };
  },
};
