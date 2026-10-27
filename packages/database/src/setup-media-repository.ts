import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  assertSetupMediaCommit,
  setupMediaDraftSchema,
  setupMediaProgress,
  setupMediaUpdateSchema,
  setupMediaUploadSchema,
  SetupImportError,
  type SetupMediaAssignment,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import {
  ensureSmartSetup,
  lockSetup,
  setupScope,
  type SetupStaff,
} from "./smart-setup-repository.js";
import {
  canonicalMediaReference,
  lockCanonicalMedia,
  mediaMetadataSelect,
  storeCanonicalMedia,
} from "./canonical-media-repository.js";
import { inspectCanonicalUpload } from "./media-storage-adapter.js";

type Tx = Prisma.TransactionClient;
async function associations(tx: Tx, staff: SetupStaff) {
  const scope = setupScope(staff);
  const [venue, products] = await Promise.all([
    tx.venueMedia.findMany({ where: scope }),
    tx.productMedia.findMany({ where: scope }),
  ]);
  const assignments: SetupMediaAssignment[] = [
    ...venue.map((r) => ({
      assetId: r.mediaAssetId,
      productId: null,
      role: r.role,
      sortOrder: r.sortOrder,
    })),
    ...products.map((r) => ({
      assetId: r.mediaAssetId,
      productId: r.productId,
      role: r.role,
      sortOrder: r.sortOrder,
    })),
  ];
  assignments.sort(
    (a, b) =>
      `${a.productId ?? "venue"}:${a.role}`.localeCompare(
        `${b.productId ?? "venue"}:${b.role}`,
      ) || a.sortOrder - b.sortOrder,
  );
  return {
    assignments,
    baseRevision: createHash("sha256")
      .update(JSON.stringify(assignments))
      .digest("hex"),
  };
}
async function validateReferences(
  tx: Tx,
  staff: SetupStaff,
  rows: SetupMediaAssignment[],
) {
  const scope = setupScope(staff);
  const assets = [...new Set(rows.map((r) => r.assetId))];
  const products = [
    ...new Set(rows.flatMap((r) => (r.productId ? [r.productId] : []))),
  ];
  const [assetCount, productCount] = await Promise.all([
    tx.mediaAsset.count({ where: { ...scope, id: { in: assets } } }),
    tx.product.count({
      where: { ...scope, id: { in: products }, archivedAt: null },
    }),
  ]);
  if (assetCount !== assets.length || productCount !== products.length)
    throw new SetupImportError("NOT_FOUND");
}
async function versioned(tx: Tx, staff: SetupStaff, expectedVersion: number) {
  await lockSetup(tx, staff);
  const progress = await ensureSmartSetup(tx, staff);
  if (progress.version !== expectedVersion)
    throw new SetupImportError(
      "CONFLICT",
      "Setup changed. Reload your saved progress.",
    );
  return progress;
}
async function audit(
  tx: Tx,
  staff: SetupStaff,
  id: string,
  action: string,
  metadata: Prisma.InputJsonValue,
) {
  await tx.auditEvent.create({
    data: {
      ...setupScope(staff),
      actorUserId: staff.userId,
      actorMembershipId: staff.membershipId,
      entityType: "SmartSetup",
      entityId: id,
      action,
      metadata,
    },
  });
}
export const setupMediaRepository = {
  async get(staff: SetupStaff) {
    return prisma.$transaction(async (tx) => {
      await lockSetup(tx, staff);
      const progress = await ensureSmartSetup(tx, staff);
      const draft = progress.mediaDraft
        ? setupMediaDraftSchema.parse(progress.mediaDraft)
        : await associations(tx, staff);
      const assetSelect = { ...mediaMetadataSelect, provenance: true } as const;
      const [venue, products, selectedAssets, recentAssets] = await Promise.all(
        [
          tx.venue.findFirstOrThrow({
            where: { id: staff.venueId, tenantId: staff.tenantId },
            select: {
              name: true,
              defaultLocale: true,
              tenant: { select: { kind: true } },
            },
          }),
          tx.product.findMany({
            where: { ...setupScope(staff), archivedAt: null },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: {
              id: true,
              published: true,
              translations: { select: { locale: true, name: true } },
            },
          }),
          // Bound the library without hiding historical selected photos.
          tx.mediaAsset.findMany({
            where: {
              ...setupScope(staff),
              id: { in: draft.assignments.map((r) => r.assetId) },
            },
            select: assetSelect,
          }),
          tx.mediaAsset.findMany({
            where: setupScope(staff),
            select: assetSelect,
            orderBy: { createdAt: "desc" },
            take: 200,
          }),
        ],
      );
      return {
        progress: {
          version: progress.version,
          step: progress.mediaStep,
          status: progress.mediaStatus,
        },
        venue,
        products,
        assignments: draft.assignments,
        assets: [
          ...new Map(
            [...recentAssets, ...selectedAssets].map((a) => [a.id, a]),
          ).values(),
        ].map((a) => ({
          ...canonicalMediaReference(a),
          provenance: a.provenance,
        })),
      };
    });
  },
  async upload(
    staff: SetupStaff,
    bytes: Buffer,
    raw: unknown,
    origin?: { sourceUrl: string; importSessionId: string },
  ) {
    const input = setupMediaUploadSchema.parse(raw);
    // Authenticate ownership before decoding or writing bytes.
    await prisma.$transaction((tx) => ensureSmartSetup(tx, staff));
    let inspected: Awaited<ReturnType<typeof inspectCanonicalUpload>>;
    try {
      inspected = await inspectCanonicalUpload(bytes);
    } catch {
      throw new SetupImportError(
        "INVALID_INPUT",
        "Use a static JPEG, PNG or WebP image up to 5 MB.",
      );
    }
    return prisma.$transaction(async (tx) => {
      await lockSetup(tx, staff);
      await ensureSmartSetup(tx, staff);
      const scope = setupScope(staff);
      const venue = await tx.venue.findFirstOrThrow({
        where: { id: staff.venueId, tenantId: staff.tenantId },
        select: { tenant: { select: { kind: true } } },
      });
      // A demo tenant never turns its uploads into actual-business public truth.
      const source =
        venue.tenant.kind === "DEMO"
          ? "DEMO"
          : origin
            ? "IMPORT"
            : input.source;
      if (source === "DEMO" && input.publicUse)
        throw new SetupImportError(
          "REVIEW_REQUIRED",
          "Demo photos are for internal review only.",
        );
      const known = await tx.mediaAsset.findFirst({
        where: {
          ...scope,
          contentHash: {
            in: [inspected.image.contentHash, inspected.normalizedHash],
          },
          source: { in: ["DEMO", "GENERATED", "IMPORT", "SYSTEM"] },
        },
        orderBy: { createdAt: "asc" },
      });
      // Re-uploading an existing illustration/derivative cannot erase provenance.
      const approveImportedOriginal =
        known?.source === "IMPORT" &&
        !!origin &&
        input.publicUse &&
        !known.approvedForPublicUse;
      if (known && !approveImportedOriginal)
        return {
          ...canonicalMediaReference(known),
          provenance: known.provenance,
        };
      const creative = await tx.creativeAsset.findFirst({
        where: {
          ...scope,
          source: "GENERATED",
          contentHash: {
            in: [inspected.image.contentHash, inspected.normalizedHash],
          },
        },
        select: { id: true },
      });
      if (creative)
        throw new SetupImportError(
          "REVIEW_REQUIRED",
          "This is a generated Creative Studio image. Use its existing approval and promotion flow to preserve provenance.",
        );
      const sourceKey = `setup:${source}:${input.publicUse}:${inspected.image.contentHash}`;
      const replay = await tx.mediaAsset.findUnique({
        where: { tenantId_venueId_sourceKey: { ...scope, sourceKey } },
      });
      if (replay)
        return {
          ...canonicalMediaReference(replay),
          provenance: replay.provenance,
        };
      const today = await tx.mediaAsset.count({
        where: {
          ...scope,
          createdAt: { gte: new Date(Date.now() - 86400000) },
          sourceKey: { startsWith: "setup:" },
        },
      });
      if (today >= 100)
        throw new SetupImportError(
          "LIMIT",
          "The daily photo upload limit has been reached.",
        );
      const asset = await storeCanonicalMedia(tx, staff, {
        image: inspected.image,
        sourceKey,
        provenance: {
          source,
          description:
            source === "DEMO"
              ? "Demo illustration uploaded for internal review; not an actual business photograph."
              : "Original staff upload; public-use rights confirmed only when explicitly selected.",
          inputContentHash: inspected.image.contentHash,
          ...(approveImportedOriginal
            ? {
                originalAssetId: known.id,
                originalContentHash: known.contentHash,
              }
            : {}),
          ...(origin ?? {}),
        },
        approvedForPublicUse: input.publicUse,
        confirmed: true,
      });
      return {
        ...canonicalMediaReference(asset),
        provenance: asset.provenance,
      };
    });
  },
  async update(staff: SetupStaff, raw: unknown) {
    const input = setupMediaUpdateSchema.parse(raw);
    await prisma.$transaction(async (tx) => {
      const progress = await versioned(tx, staff, input.expectedVersion);
      await validateReferences(tx, staff, input.assignments);
      const prior = progress.mediaDraft
        ? setupMediaDraftSchema.parse(progress.mediaDraft)
        : await associations(tx, staff);
      await tx.smartSetup.update({
        where: { id: progress.id },
        data: {
          mediaStep: input.step,
          mediaStatus: "IN_PROGRESS",
          mediaDraft: {
            baseRevision: prior.baseRevision,
            assignments: input.assignments,
          },
          version: { increment: 1 },
          updatedBy: staff.userId,
        },
      });
    });
    return this.get(staff);
  },
  async finish(
    staff: SetupStaff,
    expectedVersion: number,
    action: "SAVE" | "SKIP" | "RESET",
  ) {
    await prisma.$transaction(
      async (tx) => {
        const progress = await versioned(tx, staff, expectedVersion);
        let metadata: Prisma.InputJsonValue = { action };
        if (action === "SAVE") {
          await lockCanonicalMedia(tx, staff);
          const current = await associations(tx, staff);
          const draft = progress.mediaDraft
            ? setupMediaDraftSchema.parse(progress.mediaDraft)
            : current;
          assertSetupMediaCommit(
            progress.mediaStep,
            true,
            current.baseRevision,
            draft.baseRevision,
          );
          await validateReferences(tx, staff, draft.assignments);
          // Replace associations, not immutable assets. The before/after audit is
          // historical evidence; a transaction prevents half-applied galleries.
          await tx.venueMedia.deleteMany({ where: setupScope(staff) });
          await tx.productMedia.deleteMany({ where: setupScope(staff) });
          for (const row of draft.assignments) {
            const data = {
              ...setupScope(staff),
              mediaAssetId: row.assetId,
              sortOrder: row.sortOrder,
            };
            if (row.productId)
              await tx.productMedia.create({
                data: {
                  ...data,
                  productId: row.productId,
                  role: row.role as "PRIMARY" | "GALLERY",
                },
              });
            else
              await tx.venueMedia.create({
                data: {
                  ...data,
                  role: row.role as "LOGO" | "HERO" | "PROFILE" | "GALLERY",
                },
              });
          }
          metadata = { before: current.assignments, after: draft.assignments };
        }
        await tx.smartSetup.update({
          where: { id: progress.id },
          data: {
            ...(action === "RESET"
              ? { mediaStep: 1, mediaStatus: "IN_PROGRESS" }
              : setupMediaProgress(progress.skipped, action)),
            mediaDraft: Prisma.DbNull,
            version: { increment: 1 },
            updatedBy: staff.userId,
          },
        });
        await audit(tx, staff, progress.id, `SETUP_MEDIA_${action}`, metadata);
      },
      { timeout: 15000 },
    );
    return this.get(staff);
  },
};
