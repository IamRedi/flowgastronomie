import { Locale, type Prisma } from "@prisma/client";
import type { PlatformLocale } from "@flowgastronomie/domain";

export class ProductUnavailableError extends Error {
  constructor() {
    super("One or more products are unavailable");
    this.name = "ProductUnavailableError";
  }
}

const prismaLocales: Record<PlatformLocale, Locale> = {
  en: Locale.EN,
  de: Locale.DE,
  it: Locale.IT,
  sq: Locale.SQ,
};

export type OrderItemInput = {
  productId: string;
  quantity: number;
  notes?: string | undefined;
  variantId?: string | undefined;
  modifierOptionIds?: string[] | undefined;
};

/**
 * Resolves every ordered item against the venue menu inside the caller's
 * transaction: availability, translations, variants, modifier limits and the
 * unit price are all server-owned, so clients can never submit prices.
 */
export async function resolveOrderItems(
  transaction: Prisma.TransactionClient,
  input: {
    tenantId: string;
    venueId: string;
    requestedLocale: PlatformLocale;
    fallbackLocale: Locale;
    items: OrderItemInput[];
    channel?: "POS";
  },
) {
  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const products = await transaction.product.findMany({
    where: {
      id: { in: productIds },
      tenantId: input.tenantId,
      venueId: input.venueId,
      archivedAt: null,
      available: true,
      ...(input.channel === "POS"
        ? {
            OR: [
              { posEnabled: true },
              {
                posEnabled: null,
                published: true,
                category: { published: true },
              },
            ],
          }
        : { published: true, category: { published: true } }),
    },
    include: {
      translations: true,
      variants: { include: { translations: true } },
      modifierGroups: {
        include: {
          translations: true,
          options: { include: { translations: true } },
        },
      },
    },
  });

  if (products.length !== productIds.length) {
    throw new ProductUnavailableError();
  }

  const productsById = new Map(
    products.map((product) => [product.id, product]),
  );
  const requestedLocale = prismaLocales[input.requestedLocale];

  return input.items.map((item) => {
    const product = productsById.get(item.productId);
    if (!product || !Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new ProductUnavailableError();
    }

    const translation =
      product.translations.find((entry) => entry.locale === requestedLocale) ??
      product.translations.find(
        (entry) => entry.locale === input.fallbackLocale,
      );

    if (!translation) throw new ProductUnavailableError();

    const variant = item.variantId
      ? product.variants.find(
          (entry) => entry.id === item.variantId && entry.available,
        )
      : product.variants.find((entry) => entry.isDefault && entry.available);
    if (product.variants.length > 0 && !variant) {
      throw new ProductUnavailableError();
    }
    const variantTranslation = variant
      ? (variant.translations.find(
          (entry) => entry.locale === requestedLocale,
        ) ??
        variant.translations.find(
          (entry) => entry.locale === input.fallbackLocale,
        ))
      : null;
    if (variant && !variantTranslation) throw new ProductUnavailableError();

    const selectedIds = [...new Set(item.modifierOptionIds ?? [])];
    const selectedModifiers: Array<{
      modifierOptionId: string;
      groupName: string;
      optionName: string;
      priceDeltaMinor: number;
    }> = [];
    for (const group of product.modifierGroups) {
      const selected = group.options.filter((option) =>
        selectedIds.includes(option.id),
      );
      if (
        selected.length < group.minSelect ||
        selected.length > group.maxSelect ||
        selected.some((option) => !option.available)
      ) {
        throw new ProductUnavailableError();
      }
      const groupTranslation =
        group.translations.find((entry) => entry.locale === requestedLocale) ??
        group.translations.find(
          (entry) => entry.locale === input.fallbackLocale,
        );
      if (!groupTranslation && selected.length > 0) {
        throw new ProductUnavailableError();
      }
      for (const option of selected) {
        const optionTranslation =
          option.translations.find(
            (entry) => entry.locale === requestedLocale,
          ) ??
          option.translations.find(
            (entry) => entry.locale === input.fallbackLocale,
          );
        if (!optionTranslation || !groupTranslation) {
          throw new ProductUnavailableError();
        }
        selectedModifiers.push({
          modifierOptionId: option.id,
          groupName: groupTranslation.name,
          optionName: optionTranslation.name,
          priceDeltaMinor: option.priceDeltaMinor,
        });
      }
    }
    if (
      selectedModifiers.length !== selectedIds.length ||
      selectedIds.some(
        (id) =>
          !product.modifierGroups.some((group) =>
            group.options.some((option) => option.id === id),
          ),
      )
    ) {
      throw new ProductUnavailableError();
    }

    const optionTotal = selectedModifiers.reduce(
      (total, option) => total + option.priceDeltaMinor,
      0,
    );
    return {
      productId: product.id,
      productName: translation.name,
      quantity: item.quantity,
      unitPriceMinor:
        product.priceMinor + (variant?.priceDeltaMinor ?? 0) + optionTotal,
      station: product.station,
      variantId: variant?.id ?? null,
      variantName: variantTranslation?.name ?? null,
      modifiers: { create: selectedModifiers },
      ...(item.notes ? { notes: item.notes } : {}),
    };
  });
}
