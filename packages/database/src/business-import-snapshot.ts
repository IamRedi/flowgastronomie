import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { setupScope, type SetupStaff } from "./smart-setup-repository.js";
import { SetupImportError } from "@flowgastronomie/domain";

export const importedProductInclude = {
  translations: { orderBy: { locale: "asc" as const } },
  variants: {
    orderBy: { id: "asc" as const },
    include: { translations: { orderBy: { locale: "asc" as const } } },
  },
  modifierGroups: {
    orderBy: { id: "asc" as const },
    include: {
      translations: { orderBy: { locale: "asc" as const } },
      options: {
        orderBy: { id: "asc" as const },
        include: { translations: { orderBy: { locale: "asc" as const } } },
      },
    },
  },
  allergens: { orderBy: { allergen: "asc" as const } },
  media: { orderBy: { id: "asc" as const } },
} as const;
export async function businessCanonicalSnapshot(
  tx: Prisma.TransactionClient,
  staff: SetupStaff,
) {
  const scope = setupScope(staff);
  const [venue, website, categories, products, media, tenantVenues] =
    await Promise.all([
      tx.venue.findFirstOrThrow({
        where: { tenantId: staff.tenantId, id: staff.venueId },
        select: {
          id: true,
          name: true,
          currency: true,
          defaultLocale: true,
          tenant: {
            select: { businessProfileId: true, businessProfileVersion: true },
          },
        },
      }),
      tx.venueWebsite.findFirst({
        where: scope,
        include: { translations: { orderBy: { locale: "asc" } } },
      }),
      tx.menuCategory.findMany({
        where: scope,
        orderBy: { id: "asc" },
        include: { translations: { orderBy: { locale: "asc" } } },
        take: 501,
      }),
      tx.product.findMany({
        where: scope,
        orderBy: { id: "asc" },
        include: importedProductInclude,
        take: 1001,
      }),
      tx.venueMedia.findMany({ where: scope, orderBy: { id: "asc" } }),
      tx.venue.findMany({
        where: { tenantId: staff.tenantId },
        select: { id: true },
        orderBy: { id: "asc" },
      }),
    ]);
  if (products.length > 1000 || categories.length > 500)
    throw new SetupImportError(
      "LIMIT",
      "This catalog exceeds the bounded import review size.",
    );
  // A shared profile cannot be restored across venues added/removed since approval.
  // Expose only the revision, never other venues' records to a venue-scoped caller.
  return {
    venue,
    website,
    categories,
    products,
    media,
    tenantVenueRevision: fingerprint(tenantVenues),
  };
}
export type BusinessSnapshot = Awaited<
  ReturnType<typeof businessCanonicalSnapshot>
>;
export function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
