import { Prisma } from "@prisma/client";
import {
  SetupImportError,
  assertBusinessImportVersion,
  businessReviewSchema,
  validateBusinessReview,
  normalizeImportName,
  menuDuplicateCandidates,
  validateBusinessField,
  importNameTranslations,
  type BusinessReview,
  assertBusinessImportRevert,
  businessProfileDefaults,
  type BusinessProfileId,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import {
  businessSession,
  businessAudit,
} from "./business-import-repository.js";
import {
  businessCanonicalSnapshot,
  fingerprint,
  type BusinessSnapshot,
} from "./business-import-snapshot.js";
import { importedMenuProductData } from "./menu-import-commit.js";
import { importJson } from "./menu-import-repository.js";
import {
  lockSetup,
  setupScope,
  type SetupStaff,
} from "./smart-setup-repository.js";
import { lockCanonicalMedia } from "./canonical-media-repository.js";
import { subscriptionRepository } from "./subscription-repository.js";

type Tx = Prisma.TransactionClient;
async function locks(tx: Tx, staff: SetupStaff) {
  await lockSetup(tx, staff);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`website:${staff.tenantId}:${staff.venueId}`}, 0))`;
  await lockCanonicalMedia(tx, staff);
}
async function websitePatch(
  tx: Tx,
  staff: SetupStaff,
  snapshot: BusinessSnapshot,
  review: BusinessReview,
) {
  const scope = setupScope(staff);
  if (snapshot.website?.status === "PUBLISHED")
    throw new SetupImportError(
      "REVIEW_REQUIRED",
      "Unpublish the website before importing a new draft.",
    );
  const accepted = Object.fromEntries(
    review.fields
      .filter((f) => f.decision === "APPROVE")
      .map((f) => [f.field, f.value]),
  );
  if (
    accepted.businessType &&
    accepted.businessType !== snapshot.venue.tenant.businessProfileId
  ) {
    if ((await tx.venue.count({ where: { tenantId: staff.tenantId } })) !== 1)
      throw new SetupImportError(
        "REVIEW_REQUIRED",
        "The shared business profile must be reviewed separately for a multi-venue tenant.",
      );
    const profile = businessProfileDefaults(
      accepted.businessType as BusinessProfileId,
    );
    await tx.tenant.update({
      where: { id: staff.tenantId },
      data: {
        businessProfileId: profile.id,
        businessProfileVersion: profile.version,
      },
    });
    await tx.smartSetup.updateMany({
      where: scope,
      data: {
        profileId: profile.id,
        profileVersion: profile.version,
        version: { increment: 1 },
      },
    });
  }
  const patch: Prisma.VenueWebsiteUpdateInput = {};
  for (const field of [
    "phone",
    "contactEmail",
    "address",
    "instagramUrl",
    "facebookUrl",
    "primaryColor",
  ] as const)
    if (accepted[field] !== undefined) {
      if (field === "primaryColor") patch[field] = accepted[field];
      else patch[field] = accepted[field] || null;
    }
  if (accepted.openingHours !== undefined)
    patch.openingHours = importJson(
      validateBusinessField("openingHours", accepted.openingHours),
    );
  if (review.premiumStyleId) patch.premiumStyleId = review.premiumStyleId;
  const website =
    snapshot.website ??
    (await tx.venueWebsite.create({
      data: {
        ...scope,
        publicSlug: `venue-${staff.venueId.toLowerCase()}`,
        openingHours: [],
      },
    }));
  await tx.venueWebsite.update({ where: { id: website.id }, data: patch });
  if (accepted.venueName !== undefined)
    await tx.venue.update({
      where: { id: staff.venueId },
      data: { name: accepted.venueName },
    });
  for (const locale of ["SQ", "DE", "EN", "IT"] as const) {
    const translation: {
      heroTitle?: string;
      heroSubtitle?: string;
      storyBody?: string;
      seoTitle?: string;
      seoDescription?: string;
    } = {};
    if (accepted.venueName !== undefined)
      translation.heroTitle = accepted.venueName;
    if (accepted.description !== undefined) {
      translation.heroSubtitle = accepted.description.slice(0, 280);
      translation.storyBody = accepted.description;
    }
    if (accepted.seoTitle !== undefined)
      translation.seoTitle = accepted.seoTitle;
    if (accepted.seoDescription !== undefined)
      translation.seoDescription = accepted.seoDescription;
    await tx.venueWebsiteTranslation.upsert({
      where: { websiteId_locale: { websiteId: website.id, locale } },
      create: {
        ...scope,
        websiteId: website.id,
        locale,
        heroTitle: "",
        heroSubtitle: "",
        storyTitle: "",
        storyBody: "",
        seoTitle: "",
        seoDescription: "",
        ...translation,
      },
      update: translation,
    });
  }
}
export async function commitBusinessImport(
  staff: SetupStaff,
  id: string,
  expectedVersion: number,
  confirm: boolean,
) {
  if (!confirm) throw new SetupImportError("REVIEW_REQUIRED");
  await subscriptionRepository.assertFeature(staff.tenantId, "PUBLIC_WEBSITE");
  return prisma.$transaction(
    async (tx) => {
      await locks(tx, staff);
      const { session, state } = await businessSession(tx, staff, id);
      if (state.phase === "COMMITTED") return { id, replayed: true };
      assertBusinessImportVersion(session.version, expectedVersion);
      if (
        state.phase !== "REVIEW" ||
        session.status !== "APPROVED" ||
        !state.review?.confirm
      )
        throw new SetupImportError("REVIEW_REQUIRED");
      const review = businessReviewSchema.parse(state.review);
      const before = await businessCanonicalSnapshot(tx, staff);
      if (fingerprint(before) !== review.canonicalRevision)
        throw new SetupImportError(
          "CONFLICT",
          "Canonical data changed after review.",
        );
      validateBusinessReview(
        review,
        state,
        before.venue.currency,
        session.items.map((i) => i.id),
      );
      const scope = setupScope(staff);
      const products = [...before.products];
      const created: string[] = [];
      const updated: string[] = [];
      const createdCategories: string[] = [];
      const categoryNames = new Map<string, string>();
      const imported = new Map<string, string>();
      let sortOrder = Math.max(-1, ...products.map((p) => p.sortOrder));
      for (const row of review.items) {
        if (row.action === "SKIP") continue;
        const source = session.items.find((i) => i.id === row.id)!;
        if (!source.approvedBy || !source.approvedAt)
          throw new SetupImportError("REVIEW_REQUIRED");
        const target =
          row.action === "UPDATE"
            ? products.find((p) => p.id === row.targetProductId)
            : null;
        if (
          row.action === "UPDATE" &&
          (!target || target.published || target.archivedAt)
        )
          throw new SetupImportError(
            "REVIEW_REQUIRED",
            "Only an explicitly selected unpublished product can be updated.",
          );
        const duplicates = menuDuplicateCandidates(
          row.item,
          products
            .filter((p) => p.id !== target?.id && !p.archivedAt)
            .map((p) => ({
              id: p.id,
              names: p.translations.map((t) => t.name),
              priceMinor: p.priceMinor,
            })),
        );
        if (duplicates.length && !row.item.duplicateAcknowledged)
          throw new SetupImportError(
            "REVIEW_REQUIRED",
            "Review overlapping products before saving.",
          );
        let categoryId = row.item.categoryId;
        if (categoryId && !before.categories.some((c) => c.id === categoryId))
          throw new SetupImportError("NOT_FOUND");
        if (!categoryId) {
          const key = normalizeImportName(row.item.categoryName);
          const matches = before.categories.filter((c) =>
            c.translations.some((t) => normalizeImportName(t.name) === key),
          );
          if (matches.length > 1)
            throw new SetupImportError(
              "REVIEW_REQUIRED",
              "Choose the exact category.",
            );
          categoryId = matches[0]?.id ?? categoryNames.get(key) ?? null;
          if (!categoryId) {
            const category = await tx.menuCategory.create({
              data: {
                ...scope,
                published: false,
                sortOrder: before.categories.length + createdCategories.length,
                translations: {
                  create: importNameTranslations(row.item.categoryName).map(
                    (t) => ({
                      ...scope,
                      locale: t.locale.toUpperCase() as
                        "EN" | "DE" | "IT" | "SQ",
                      name: t.name,
                    }),
                  ),
                },
              },
            });
            categoryId = category.id;
            createdCategories.push(categoryId);
            categoryNames.set(key, categoryId);
          }
        }
        const data = importedMenuProductData(
          scope,
          row.item,
          categoryId,
          target?.sortOrder ?? ++sortOrder,
          {
            source: "BUSINESS_IMPORT_V2",
            sessionId: id,
            itemId: row.id,
            sourceIds: session.sources.map((s) => s.id),
            sourceHashes: session.sources.map((s) => s.contentHash),
            approvedBy: source.approvedBy,
            approvedAt: source.approvedAt.toISOString(),
            translationStrategy: "SOURCE_TEXT_FALLBACK",
            priceApproved: true,
          },
        );
        let productId: string;
        if (target) {
          // Existing immutable order snapshots remain untouched. Configuration IDs are
          // recorded in the before snapshot and can be restored only while unused.
          await tx.productTranslation.deleteMany({
            where: { ...scope, productId: target.id },
          });
          await tx.productVariant.deleteMany({
            where: { ...scope, productId: target.id },
          });
          await tx.productModifierGroup.deleteMany({
            where: { ...scope, productId: target.id },
          });
          await tx.productAllergen.deleteMany({
            where: { productId: target.id },
          });
          await tx.product.update({ where: { id: target.id }, data });
          productId = target.id;
          updated.push(productId);
        } else {
          const saved = await tx.product.create({ data });
          productId = saved.id;
          created.push(productId);
          products.push({
            ...saved,
            translations: data.translations.create.map((t, index) => ({
              ...t,
              id: `review-${index}`,
              productId,
            })),
            variants: [],
            modifierGroups: [],
            allergens: [],
            media: [],
          });
        }
        imported.set(row.id, productId);
        await tx.importItem.update({
          where: { id: row.id },
          data: { status: "IMPORTED", importedProductId: productId },
        });
      }
      await websitePatch(tx, staff, before, review);
      for (const row of review.media) {
        const asset = await tx.mediaAsset.findFirst({
          where: { ...scope, id: row.assetId },
        });
        if (!asset) throw new SetupImportError("NOT_FOUND");
        const productId = row.targetItemId
          ? imported.get(row.targetItemId)
          : null;
        if (row.targetItemId && !productId)
          throw new SetupImportError("NOT_FOUND");
        if (productId) {
          const role = row.role as "PRIMARY" | "GALLERY";
          if (role === "PRIMARY")
            await tx.productMedia.deleteMany({
              where: { ...scope, productId, role },
            });
          const maximum = await tx.productMedia.aggregate({
            where: { ...scope, productId, role },
            _max: { sortOrder: true },
          });
          await tx.productMedia.create({
            data: {
              ...scope,
              productId,
              mediaAssetId: row.assetId,
              role,
              sortOrder:
                role === "PRIMARY" ? 0 : (maximum._max.sortOrder ?? -1) + 1,
            },
          });
        } else {
          const role = row.role as "LOGO" | "HERO" | "GALLERY";
          if (role !== "GALLERY")
            await tx.venueMedia.deleteMany({ where: { ...scope, role } });
          const maximum = await tx.venueMedia.aggregate({
            where: { ...scope, role },
            _max: { sortOrder: true },
          });
          await tx.venueMedia.create({
            data: {
              ...scope,
              mediaAssetId: row.assetId,
              role,
              sortOrder:
                role === "GALLERY" ? (maximum._max.sortOrder ?? -1) + 1 : 0,
            },
          });
        }
      }
      const after = await businessCanonicalSnapshot(tx, staff);
      const receipt = {
        before,
        after,
        created,
        updated,
        createdCategories,
        afterHash: fingerprint(after),
      };
      await tx.importSession.update({
        where: { id },
        data: {
          businessData: importJson({ ...state, phase: "COMMITTED" }),
          businessReceipt: importJson(receipt),
          status: "IMPORTED",
          importedAt: new Date(),
          importedBy: staff.userId,
          version: { increment: 1 },
        },
      });
      await businessAudit(tx, staff, id, "BUSINESS_IMPORT_COMMITTED", {
        created,
        updated,
        createdCategories,
        beforeHash: fingerprint(before),
        afterHash: receipt.afterHash,
        publication: "DRAFT",
      });
      return { id, replayed: false };
    },
    {
      timeout: 30_000,
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

type ImportReceipt = {
  before: BusinessSnapshot;
  after: BusinessSnapshot;
  created: string[];
  updated: string[];
  createdCategories: string[];
  afterHash: string;
};
export async function revertBusinessImport(
  staff: SetupStaff,
  id: string,
  expectedVersion: number,
  confirm: boolean,
) {
  if (!confirm) throw new SetupImportError("REVIEW_REQUIRED");
  return prisma.$transaction(
    async (tx) => {
      await locks(tx, staff);
      const { session, state } = await businessSession(tx, staff, id);
      if (state.phase === "REVERTED") return { id, replayed: true };
      assertBusinessImportVersion(session.version, expectedVersion);
      if (state.phase !== "COMMITTED" || !session.businessReceipt)
        throw new SetupImportError("CONFLICT");
      const receipt = session.businessReceipt as unknown as ImportReceipt;
      const current = await businessCanonicalSnapshot(tx, staff);
      const scope = setupScope(staff);
      const affected = [...receipt.created, ...receipt.updated];
      const orders =
        (await tx.orderItem.count({
          where: { productId: { in: affected }, order: scope },
        })) +
        (await tx.onlineOrderItem.count({
          where: { productId: { in: affected }, onlineOrder: scope },
        }));
      assertBusinessImportRevert({
        currentHash: fingerprint(current),
        importedHash: receipt.afterHash,
        published:
          current.website?.status === "PUBLISHED" ||
          current.products.some((p) => affected.includes(p.id) && p.published),
        usedByOrders: orders > 0,
      });
      // Retain new canonical IDs, immutable originals, import links and snapshots as
      // history. Archived additions cannot be edited, offered, or previewed as menu.
      await tx.product.updateMany({
        where: { ...scope, id: { in: receipt.created } },
        data: { published: false, available: false, archivedAt: new Date() },
      });
      for (const product of receipt.before.products.filter((p) =>
        receipt.updated.includes(p.id),
      )) {
        const {
          id: productId,
          translations,
          variants,
          modifierGroups,
          allergens,
          media: _media,
          ...data
        } = product;
        await tx.productTranslation.deleteMany({
          where: { ...scope, productId },
        });
        await tx.productVariant.deleteMany({ where: { ...scope, productId } });
        await tx.productModifierGroup.deleteMany({
          where: { ...scope, productId },
        });
        await tx.productAllergen.deleteMany({ where: { productId } });
        await tx.product.update({
          where: { id: productId },
          data: {
            ...data,
            dataProvenance:
              data.dataProvenance === null
                ? Prisma.DbNull
                : importJson(data.dataProvenance),
            translations: {
              create: translations.map(
                ({ productId: _p, ...translation }) => translation,
              ),
            },
            variants: {
              create: variants.map(
                ({ productId: _p, translations: names, ...variant }) => ({
                  ...variant,
                  translations: {
                    create: names.map(({ variantId: _v, ...name }) => name),
                  },
                }),
              ),
            },
            modifierGroups: {
              create: modifierGroups.map(
                ({
                  productId: _p,
                  translations: names,
                  options,
                  ...group
                }) => ({
                  ...group,
                  translations: {
                    create: names.map(({ groupId: _g, ...name }) => name),
                  },
                  options: {
                    create: options.map(
                      ({ groupId: _g, translations: names, ...option }) => ({
                        ...option,
                        translations: {
                          create: names.map(
                            ({ optionId: _o, ...name }) => name,
                          ),
                        },
                      }),
                    ),
                  },
                }),
              ),
            },
            allergens: {
              create: allergens.map(
                ({ productId: _p, ...allergen }) => allergen,
              ),
            },
          },
        });
      }
      await tx.productMedia.deleteMany({
        where: { ...scope, productId: { in: affected } },
      });
      for (const product of receipt.before.products.filter((p) =>
        receipt.updated.includes(p.id),
      ))
        if (product.media.length)
          await tx.productMedia.createMany({ data: product.media });
      await tx.venueMedia.deleteMany({ where: scope });
      if (receipt.before.media.length)
        await tx.venueMedia.createMany({ data: receipt.before.media });
      const before = receipt.before.website;
      if (before) {
        const {
          id: websiteId,
          translations,
          createdAt: _created,
          updatedAt: _updated,
          ...data
        } = before;
        await tx.venueWebsite.update({
          where: { id: websiteId },
          data: { ...data, openingHours: importJson(data.openingHours) },
        });
        await tx.venueWebsiteTranslation.deleteMany({
          where: { ...scope, websiteId },
        });
        if (translations.length)
          await tx.venueWebsiteTranslation.createMany({ data: translations });
      } else if (current.website) {
        // Provisioned venues normally already have a website. Keep a new website's
        // identity as an empty private draft instead of cascading history deletion.
        await tx.venueWebsite.update({
          where: { id: current.website.id },
          data: {
            phone: null,
            contactEmail: null,
            address: null,
            instagramUrl: null,
            facebookUrl: null,
            premiumStyleId: null,
            primaryColor: "#17382f",
            openingHours: [],
          },
        });
        await tx.venueWebsiteTranslation.updateMany({
          where: { ...scope, websiteId: current.website.id },
          data: {
            heroTitle: "",
            heroSubtitle: "",
            storyBody: "",
            seoTitle: "",
            seoDescription: "",
          },
        });
      }
      await tx.venue.update({
        where: { id: staff.venueId },
        data: { name: receipt.before.venue.name },
      });
      await tx.tenant.update({
        where: { id: staff.tenantId },
        data: receipt.before.venue.tenant,
      });
      await tx.smartSetup.updateMany({
        where: scope,
        data: {
          profileId: receipt.before.venue.tenant.businessProfileId ?? "GENERIC",
          profileVersion:
            receipt.before.venue.tenant.businessProfileVersion ??
            businessProfileDefaults("GENERIC").version,
          version: { increment: 1 },
        },
      });
      await tx.importSession.update({
        where: { id },
        data: {
          businessData: importJson({ ...state, phase: "REVERTED" }),
          version: { increment: 1 },
        },
      });
      await businessAudit(tx, staff, id, "BUSINESS_IMPORT_REVERTED", {
        archivedProductIds: receipt.created,
        restoredProductIds: receipt.updated,
        sourceReceiptPreserved: true,
      });
      return { id, replayed: false };
    },
    {
      timeout: 30_000,
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}
