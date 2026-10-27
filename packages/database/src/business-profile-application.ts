import type { Prisma } from "@prisma/client";
import type { BusinessProfileTemplate } from "@flowgastronomie/domain";

// Shared by initial provisioning and explicit setup. No product/price overwrite.
// The caller holds the venue setup lock when applying to an existing business.
export async function applyBusinessProfileCategories(
  tx: Prisma.TransactionClient,
  scope: { tenantId: string; venueId: string },
  template: BusinessProfileTemplate,
) {
  const existing = await tx.menuCategory.findMany({
    where: scope,
    include: { translations: true },
  });
  let nextOrder = existing.reduce((n, c) => Math.max(n, c.sortOrder + 1), 0);
  for (const category of template.categories) {
    if (
      existing.some((c) =>
        (["en", "de", "it", "sq"] as const).every((locale) =>
          c.translations.some(
            (t) =>
              t.locale === locale.toUpperCase() &&
              t.name === category.translations[locale],
          ),
        ),
      )
    )
      continue;
    await tx.menuCategory.create({
      data: {
        ...scope,
        sortOrder: nextOrder++,
        published: false,
        translations: {
          create: (["en", "de", "it", "sq"] as const).map((locale) => ({
            ...scope,
            locale: locale.toUpperCase() as "EN" | "DE" | "IT" | "SQ",
            name: category.translations[locale],
          })),
        },
      },
    });
  }
}
