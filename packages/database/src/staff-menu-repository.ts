import { createHash } from "node:crypto";
import type { AllergenCode, Locale, StationType } from "@prisma/client";
import {
  assertStaffPermission,
  SetupImportError,
  assertProductMenuConfiguration,
  type MenuModifierGroupConfiguration,
  type MenuVariantConfiguration,
  type PlatformLocale,
  type StaffRole,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";

type StaffScope = {
  tenantId: string;
  venueId: string;
  role: StaffRole;
  userId: string;
  membershipId: string;
};

export type MenuTranslationInput = {
  locale: PlatformLocale;
  name: string;
  description?: string | null | undefined;
};

export type StaffMenuProduct = {
  id: string;
  categoryId: string;
  priceMinor: number;
  currency: string;
  sortOrder: number;
  available: boolean;
  published: boolean;
  posEnabled?: boolean | null;
  revision?: string;
  station: StationType;
  translations: MenuTranslationInput[];
  allergens: AllergenCode[];
  variantCount: number;
  modifierGroupCount: number;
};

export type StaffMenuCategory = {
  id: string;
  sortOrder: number;
  published: boolean;
  translations: Array<Omit<MenuTranslationInput, "description">>;
  products: StaffMenuProduct[];
};

export type StaffMenu = {
  venue: { id: string; name: string; currency: string };
  categories: StaffMenuCategory[];
};

export type StaffProductConfiguration = {
  productId: string;
  basePriceMinor: number;
  variants: MenuVariantConfiguration[];
  modifierGroups: MenuModifierGroupConfiguration[];
};

export type StaffMenuRepository = {
  list(staff: StaffScope): Promise<StaffMenu>;
  createCategory(input: {
    staff: StaffScope;
    published: boolean;
    sortOrder: number;
    translations: Array<Omit<MenuTranslationInput, "description">>;
  }): Promise<StaffMenuCategory>;
  updateCategory(input: {
    staff: StaffScope;
    categoryId: string;
    published: boolean;
    sortOrder: number;
    translations: Array<Omit<MenuTranslationInput, "description">>;
  }): Promise<StaffMenuCategory>;
  createProduct(input: {
    staff: StaffScope;
    categoryId: string;
    priceMinor: number;
    sortOrder: number;
    available: boolean;
    published: boolean;
    station: StationType;
    translations: MenuTranslationInput[];
  }): Promise<StaffMenuProduct>;
  updateProduct(input: {
    expectedRevision?: string | undefined;
    staff: StaffScope;
    productId: string;
    categoryId: string;
    priceMinor: number;
    sortOrder: number;
    available: boolean;
    published: boolean;
    station: StationType;
    translations: MenuTranslationInput[];
  }): Promise<StaffMenuProduct>;
  getConfiguration(input: {
    staff: StaffScope;
    productId: string;
  }): Promise<StaffProductConfiguration>;
  replaceConfiguration(input: {
    staff: StaffScope;
    productId: string;
    variants: MenuVariantConfiguration[];
    modifierGroups: MenuModifierGroupConfiguration[];
  }): Promise<StaffProductConfiguration>;
};

export class StaffMenuResourceNotFoundError extends Error {
  constructor(resource: "venue" | "category" | "product") {
    super(`The ${resource} was not found in this venue`);
    this.name = "StaffMenuResourceNotFoundError";
  }
}

const databaseLocale: Record<PlatformLocale, Locale> = {
  en: "EN",
  de: "DE",
  it: "IT",
  sq: "SQ",
};

const platformLocale: Record<Locale, PlatformLocale> = {
  EN: "en",
  DE: "de",
  IT: "it",
  SQ: "sq",
};

const categoryInclude = {
  translations: { orderBy: { locale: "asc" as const } },
  products: {
    where: { archivedAt: null },
    orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }],
    include: {
      translations: { orderBy: { locale: "asc" as const } },
      allergens: true,
      _count: { select: { variants: true, modifierGroups: true } },
    },
  },
};

function mapProduct(product: {
  id: string;
  categoryId: string;
  priceMinor: number;
  currency: string;
  sortOrder: number;
  available: boolean;
  published: boolean;
  posEnabled?: boolean | null;
  station: StationType;
  translations: Array<{
    locale: Locale;
    name: string;
    description: string | null;
  }>;
  allergens: Array<{ allergen: AllergenCode }>;
  _count: { variants: number; modifierGroups: number };
}): StaffMenuProduct {
  return {
    ...product,
    revision: createHash("sha256")
      .update(
        JSON.stringify({
          categoryId: product.categoryId,
          priceMinor: product.priceMinor,
          currency: product.currency,
          sortOrder: product.sortOrder,
          available: product.available,
          published: product.published,
          station: product.station,
          translations: product.translations,
        }),
      )
      .digest("hex"),
    translations: product.translations.map((translation) => ({
      locale: platformLocale[translation.locale],
      name: translation.name,
      description: translation.description,
    })),
    allergens: product.allergens.map((entry) => entry.allergen),
    variantCount: product._count.variants,
    modifierGroupCount: product._count.modifierGroups,
  };
}

function mapCategory(category: {
  id: string;
  sortOrder: number;
  published: boolean;
  translations: Array<{ locale: Locale; name: string }>;
  products: Parameters<typeof mapProduct>[0][];
}): StaffMenuCategory {
  return {
    id: category.id,
    sortOrder: category.sortOrder,
    published: category.published,
    translations: category.translations.map((translation) => ({
      locale: platformLocale[translation.locale],
      name: translation.name,
    })),
    products: category.products.map(mapProduct),
  };
}

async function assertCategoryInScope(
  categoryId: string,
  staff: StaffScope,
): Promise<void> {
  const category = await prisma.menuCategory.findFirst({
    where: {
      id: categoryId,
      tenantId: staff.tenantId,
      venueId: staff.venueId,
    },
    select: { id: true },
  });
  if (!category) throw new StaffMenuResourceNotFoundError("category");
}

const configurationInclude = {
  variants: {
    orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }],
    include: { translations: { orderBy: { locale: "asc" as const } } },
  },
  modifierGroups: {
    orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }],
    include: {
      translations: { orderBy: { locale: "asc" as const } },
      options: {
        orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }],
        include: { translations: { orderBy: { locale: "asc" as const } } },
      },
    },
  },
};

function localizedNames(translations: Array<{ locale: Locale; name: string }>) {
  return translations.map((translation) => ({
    locale: platformLocale[translation.locale],
    name: translation.name,
  }));
}

function mapConfiguration(product: {
  id: string;
  priceMinor: number;
  variants: Array<{
    priceDeltaMinor: number;
    sortOrder: number;
    available: boolean;
    isDefault: boolean;
    translations: Array<{ locale: Locale; name: string }>;
  }>;
  modifierGroups: Array<{
    minSelect: number;
    maxSelect: number;
    sortOrder: number;
    translations: Array<{ locale: Locale; name: string }>;
    options: Array<{
      priceDeltaMinor: number;
      sortOrder: number;
      available: boolean;
      translations: Array<{ locale: Locale; name: string }>;
    }>;
  }>;
}): StaffProductConfiguration {
  return {
    productId: product.id,
    basePriceMinor: product.priceMinor,
    variants: product.variants.map((variant) => ({
      priceDeltaMinor: variant.priceDeltaMinor,
      sortOrder: variant.sortOrder,
      available: variant.available,
      isDefault: variant.isDefault,
      translations: localizedNames(variant.translations),
    })),
    modifierGroups: product.modifierGroups.map((group) => ({
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      sortOrder: group.sortOrder,
      translations: localizedNames(group.translations),
      options: group.options.map((option) => ({
        priceDeltaMinor: option.priceDeltaMinor,
        sortOrder: option.sortOrder,
        available: option.available,
        translations: localizedNames(option.translations),
      })),
    })),
  };
}

async function scopedProduct(productId: string, staff: StaffScope) {
  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      tenantId: staff.tenantId,
      venueId: staff.venueId,
      archivedAt: null,
    },
    include: configurationInclude,
  });
  if (!product) throw new StaffMenuResourceNotFoundError("product");
  return product;
}

export const staffMenuRepository: StaffMenuRepository = {
  async list(staff) {
    assertStaffPermission(staff.role, "MENU_VIEW");
    const venue = await prisma.venue.findFirst({
      where: { id: staff.venueId, tenantId: staff.tenantId },
      select: {
        id: true,
        name: true,
        currency: true,
        categories: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          include: categoryInclude,
        },
      },
    });
    if (!venue) throw new StaffMenuResourceNotFoundError("venue");

    return {
      venue: { id: venue.id, name: venue.name, currency: venue.currency },
      categories: venue.categories.map(mapCategory),
    };
  },

  async createCategory({ staff, published, sortOrder, translations }) {
    assertStaffPermission(staff.role, "MENU_MANAGE");
    const category = await prisma.menuCategory.create({
      data: {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        published,
        sortOrder,
        translations: {
          create: translations.map((translation) => ({
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            locale: databaseLocale[translation.locale],
            name: translation.name,
          })),
        },
      },
      include: categoryInclude,
    });
    return mapCategory(category);
  },

  async updateCategory({
    staff,
    categoryId,
    published,
    sortOrder,
    translations,
  }) {
    assertStaffPermission(staff.role, "MENU_MANAGE");
    await assertCategoryInScope(categoryId, staff);
    const category = await prisma.$transaction(async (transaction) => {
      await transaction.menuCategory.update({
        where: { id: categoryId },
        data: { published, sortOrder },
      });
      for (const translation of translations) {
        await transaction.menuCategoryTranslation.upsert({
          where: {
            categoryId_locale: {
              categoryId,
              locale: databaseLocale[translation.locale],
            },
          },
          create: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            categoryId,
            locale: databaseLocale[translation.locale],
            name: translation.name,
          },
          update: { name: translation.name },
        });
      }
      return transaction.menuCategory.findUniqueOrThrow({
        where: { id: categoryId },
        include: categoryInclude,
      });
    });
    return mapCategory(category);
  },

  async createProduct({ staff, categoryId, translations, ...data }) {
    assertStaffPermission(staff.role, "MENU_MANAGE");
    await assertCategoryInScope(categoryId, staff);
    const venue = await prisma.venue.findFirstOrThrow({
      where: { id: staff.venueId, tenantId: staff.tenantId },
      select: { currency: true },
    });
    const product = await prisma.product.create({
      data: {
        ...data,
        currency: venue.currency,
        categoryId,
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        translations: {
          create: translations.map((translation) => ({
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            locale: databaseLocale[translation.locale],
            name: translation.name,
            description: translation.description ?? null,
          })),
        },
      },
      include: {
        translations: { orderBy: { locale: "asc" } },
        allergens: true,
        _count: { select: { variants: true, modifierGroups: true } },
      },
    });
    return mapProduct(product);
  },

  async updateProduct({
    staff,
    productId,
    categoryId,
    translations,
    expectedRevision,
    ...data
  }) {
    assertStaffPermission(staff.role, "MENU_MANAGE");
    await assertCategoryInScope(categoryId, staff);
    const existing = await prisma.product.findFirst({
      where: {
        id: productId,
        archivedAt: null,
        tenantId: staff.tenantId,
        venueId: staff.venueId,
      },
      select: { id: true },
    });
    if (!existing) throw new StaffMenuResourceNotFoundError("product");

    const product = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM "Product" WHERE id=${productId} AND "tenantId"=${staff.tenantId} AND "venueId"=${staff.venueId} FOR UPDATE`;
      const current = await transaction.product.findFirstOrThrow({
        where: {
          id: productId,
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          archivedAt: null,
        },
        include: {
          translations: { orderBy: { locale: "asc" } },
          allergens: true,
          _count: { select: { variants: true, modifierGroups: true } },
        },
      });
      if (expectedRevision && mapProduct(current).revision !== expectedRevision)
        throw new SetupImportError(
          "CONFLICT",
          "The product changed. Reload before saving.",
        );
      await transaction.product.update({
        where: { id: productId },
        data: { ...data, categoryId },
      });
      for (const translation of translations) {
        await transaction.productTranslation.upsert({
          where: {
            productId_locale: {
              productId,
              locale: databaseLocale[translation.locale],
            },
          },
          create: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            productId,
            locale: databaseLocale[translation.locale],
            name: translation.name,
            description: translation.description ?? null,
          },
          update: {
            name: translation.name,
            description: translation.description ?? null,
          },
        });
      }
      return transaction.product.findUniqueOrThrow({
        where: { id: productId },
        include: {
          translations: { orderBy: { locale: "asc" } },
          allergens: true,
          _count: { select: { variants: true, modifierGroups: true } },
        },
      });
    });
    return mapProduct(product);
  },

  async getConfiguration({ staff, productId }) {
    assertStaffPermission(staff.role, "MENU_VIEW");
    return mapConfiguration(await scopedProduct(productId, staff));
  },

  async replaceConfiguration({ staff, productId, variants, modifierGroups }) {
    assertStaffPermission(staff.role, "MENU_MANAGE");
    const product = await scopedProduct(productId, staff);
    assertProductMenuConfiguration({
      basePriceMinor: product.priceMinor,
      variants,
      modifierGroups,
    });
    const saved = await prisma.$transaction(async (transaction) => {
      await transaction.productVariant.deleteMany({ where: { productId } });
      await transaction.productModifierGroup.deleteMany({
        where: { productId },
      });
      for (const variant of variants) {
        await transaction.productVariant.create({
          data: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            productId,
            priceDeltaMinor: variant.priceDeltaMinor,
            sortOrder: variant.sortOrder,
            available: variant.available,
            isDefault: variant.isDefault,
            translations: {
              create: variant.translations.map((translation) => ({
                locale: databaseLocale[translation.locale],
                name: translation.name,
              })),
            },
          },
        });
      }
      for (const group of modifierGroups) {
        await transaction.productModifierGroup.create({
          data: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            productId,
            minSelect: group.minSelect,
            maxSelect: group.maxSelect,
            sortOrder: group.sortOrder,
            translations: {
              create: group.translations.map((translation) => ({
                locale: databaseLocale[translation.locale],
                name: translation.name,
              })),
            },
            options: {
              create: group.options.map((option) => ({
                tenantId: staff.tenantId,
                venueId: staff.venueId,
                priceDeltaMinor: option.priceDeltaMinor,
                sortOrder: option.sortOrder,
                available: option.available,
                translations: {
                  create: option.translations.map((translation) => ({
                    locale: databaseLocale[translation.locale],
                    name: translation.name,
                  })),
                },
              })),
            },
          },
        });
      }
      await transaction.auditEvent.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
          action: "PRODUCT_CONFIGURATION_REPLACED",
          entityType: "Product",
          entityId: productId,
          metadata: {
            variants: variants.length,
            modifierGroups: modifierGroups.length,
          },
        },
      });
      return transaction.product.findUniqueOrThrow({
        where: { id: productId },
        include: configurationInclude,
      });
    });
    return mapConfiguration(saved);
  },
};
