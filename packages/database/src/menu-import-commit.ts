import {
  type ReviewedMenuItem,
  assertStaffPermission,
  importNameTranslations,
  menuDuplicateCandidates,
  normalizeImportName,
  reviewedMenuItemSchema,
  validateReviewedMenuItem,
  SetupImportError,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import {
  lockSetup,
  setupScope,
  type SetupStaff,
} from "./smart-setup-repository.js";
import {
  importJson,
  menuImportProducts,
  scopedImportSession,
} from "./menu-import-repository.js";
const locales = (name: string) =>
  importNameTranslations(name).map((t) => ({
    locale: t.locale.toUpperCase() as "EN" | "DE" | "IT" | "SQ",
    name: t.name,
  }));

export async function commitMenuImport(
  staff: SetupStaff,
  id: string,
  expectedVersion: number,
  confirm: boolean,
) {
  assertStaffPermission(staff.role, "IMPORT_MANAGE");
  if (!confirm)
    throw new SetupImportError(
      "REVIEW_REQUIRED",
      "Confirm the import explicitly.",
    );
  return prisma.$transaction(
    async (tx) => {
      await lockSetup(tx, staff);
      const session = await scopedImportSession(tx, staff, id);
      if (session.businessData)
        throw new SetupImportError(
          "CONFLICT",
          "Use the unified business review.",
        );
      // Durable receipt: a replay after a lost HTTP response returns the same IDs.
      if (session.importedAt)
        return {
          sessionId: id,
          productIds: session.items.flatMap((i) =>
            i.importedProductId ? [i.importedProductId] : [],
          ),
          replayed: true,
        };
      if (session.version !== expectedVersion)
        throw new SetupImportError(
          "CONFLICT",
          "The review changed. Reload before importing.",
        );
      const approved = session.items.filter((i) => i.status === "APPROVED");
      if (
        session.status !== "APPROVED" ||
        !approved.length ||
        session.items.some(
          (i) => i.status !== "APPROVED" && i.status !== "REJECTED",
        )
      )
        throw new SetupImportError(
          "REVIEW_REQUIRED",
          "Approve or reject every proposed product before importing.",
        );
      const scope = setupScope(staff);
      const venue = await tx.venue.findFirstOrThrow({
        where: { tenantId: staff.tenantId, id: staff.venueId },
      });
      const existing = await menuImportProducts(tx, staff);
      const createdCategories = new Map<string, string>();
      const productIds: string[] = [];
      let categoryOrder =
        (
          await tx.menuCategory.aggregate({
            where: scope,
            _max: { sortOrder: true },
          })
        )._max.sortOrder ?? -1;
      let productOrder =
        (
          await tx.product.aggregate({
            where: scope,
            _max: { sortOrder: true },
          })
        )._max.sortOrder ?? -1;
      for (const row of approved) {
        if (!row.approvedBy || !row.approvedAt)
          throw new SetupImportError("REVIEW_REQUIRED");
        const reviewed = reviewedMenuItemSchema.parse(row.reviewed);
        const { item, configuration } = validateReviewedMenuItem(
          reviewed,
          venue.currency,
          menuDuplicateCandidates(reviewed, existing),
        );
        let categoryId = item.categoryId;
        if (categoryId) {
          if (
            !(await tx.menuCategory.findFirst({
              where: { ...scope, id: categoryId },
            }))
          )
            throw new SetupImportError("NOT_FOUND");
        } else {
          const key = normalizeImportName(item.categoryName);
          categoryId = createdCategories.get(key) ?? null;
          if (!categoryId) {
            const category = await tx.menuCategory.create({
              data: {
                ...scope,
                published: false,
                sortOrder: ++categoryOrder,
                translations: {
                  create: locales(item.categoryName).map((t) => ({
                    ...scope,
                    ...t,
                  })),
                },
              },
            });
            categoryId = category.id;
            createdCategories.set(key, categoryId);
          }
        }
        const product = await tx.product.create({
          data: importedMenuProductData(
            scope,
            item,
            categoryId,
            ++productOrder,
            {
              source: "MENU_IMPORT",
              sessionId: id,
              itemId: row.id,
              sourceIds: session.sources.map((s) => s.id),
              sourceHashes: session.sources.map((s) => s.contentHash),
              approvedBy: row.approvedBy,
              approvedAt: row.approvedAt.toISOString(),
              importedBy: staff.userId,
              sourceLocale: session.locale,
              translationStrategy: "SOURCE_TEXT_FALLBACK",
              allergensExplicitlyApproved: item.approvedAllergens,
            },
          ),
        });
        productIds.push(product.id);
        existing.push({
          id: product.id,
          names: [item.name],
          priceMinor: item.priceMinor!,
        });
        await tx.importItem.update({
          where: { id: row.id },
          data: { status: "IMPORTED", importedProductId: product.id },
        });
      }
      await tx.importSession.update({
        where: { id },
        data: {
          status: "IMPORTED",
          importedAt: new Date(),
          importedBy: staff.userId,
          version: { increment: 1 },
        },
      });
      await tx.smartSetup.updateMany({
        where: { ...scope, activeImportSessionId: id },
        data: { step: 4, version: { increment: 1 } },
      });
      await tx.auditEvent.create({
        data: {
          ...scope,
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
          action: "MENU_IMPORT_COMMITTED",
          entityType: "ImportSession",
          entityId: id,
          metadata: {
            productIds,
            categoryIds: [...createdCategories.values()],
            publication: "DRAFT",
            count: productIds.length,
          },
        },
      });
      return { sessionId: id, productIds, replayed: false };
    },
    { timeout: 30_000 },
  );
}

export function importedMenuProductData(
  scope: { tenantId: string; venueId: string },
  item: ReviewedMenuItem,
  categoryId: string,
  sortOrder: number,
  provenance: unknown,
) {
  const { configuration } = validateReviewedMenuItem(item, item.currency, []);
  return {
    ...scope,
    categoryId,
    priceMinor: item.priceMinor!,
    currency: item.currency,
    station: item.station,
    published: false,
    posEnabled: false,
    available: false,
    sortOrder,
    dataProvenance: importJson(provenance),
    translations: {
      create: locales(item.name).map((t) => ({
        ...scope,
        ...t,
        description: item.description || null,
      })),
    },
    allergens: {
      create: item.approvedAllergens.map((allergen) => ({ allergen })),
    },
    variants: {
      create: configuration.variants.map((v) => ({
        ...scope,
        priceDeltaMinor: v.priceDeltaMinor,
        sortOrder: v.sortOrder,
        available: true,
        isDefault: v.isDefault,
        translations: {
          create: v.translations.map((t) => ({
            locale: t.locale.toUpperCase() as "EN" | "DE" | "IT" | "SQ",
            name: t.name,
          })),
        },
      })),
    },
    modifierGroups: {
      create: configuration.modifierGroups.map((g) => ({
        ...scope,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        sortOrder: g.sortOrder,
        translations: {
          create: g.translations.map((t) => ({
            locale: t.locale.toUpperCase() as "EN" | "DE" | "IT" | "SQ",
            name: t.name,
          })),
        },
        options: {
          create: g.options.map((o) => ({
            ...scope,
            priceDeltaMinor: o.priceDeltaMinor,
            sortOrder: o.sortOrder,
            available: true,
            translations: {
              create: o.translations.map((t) => ({
                locale: t.locale.toUpperCase() as "EN" | "DE" | "IT" | "SQ",
                name: t.name,
              })),
            },
          })),
        },
      })),
    },
  };
}
