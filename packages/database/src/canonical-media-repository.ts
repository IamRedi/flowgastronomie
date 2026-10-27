import type { Prisma, MediaAsset } from "@prisma/client";
import {
  assertMediaApproval,
  assertStaffPermission,
  mediaDisclosure,
  type MediaProvenance,
  type CanonicalMediaReference,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import type { StaffIdentity } from "./staff-auth-repository.js";
import { normalizeCanonicalImage } from "./media-storage-adapter.js";
type Scope = { tenantId: string; venueId: string };
export async function lockCanonicalMedia(
  tx: Prisma.TransactionClient,
  scope: Scope,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`canonical-media:${scope.tenantId}:${scope.venueId}`}, 0))`;
}
type Actor = Scope & {
  userId: string;
  membershipId: string;
  role: StaffIdentity["role"];
};
export const mediaMetadataSelect = {
  id: true,
  source: true,
  width: true,
  height: true,
  contentHash: true,
  approvedForPublicUse: true,
} as const;
export function canonicalMediaReference(
  asset: Pick<
    MediaAsset,
    | "id"
    | "source"
    | "width"
    | "height"
    | "contentHash"
    | "approvedForPublicUse"
  >,
): CanonicalMediaReference {
  return {
    id: asset.id,
    source: asset.source,
    width: asset.width,
    height: asset.height,
    contentHash: asset.contentHash,
    approvedForPublicUse: asset.approvedForPublicUse,
    url: `/v1/media/${asset.id}`,
    label: mediaDisclosure(asset.source),
  };
}
export async function storeCanonicalMedia(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: {
    image: Awaited<ReturnType<typeof normalizeCanonicalImage>>;
    sourceKey: string;
    provenance: MediaProvenance;
    approvedForPublicUse: boolean;
    confirmed: boolean;
  },
) {
  assertStaffPermission(actor.role, "WEBSITE_MANAGE");
  assertMediaApproval(
    input.provenance,
    input.approvedForPublicUse,
    input.confirmed,
  );
  const membership = await tx.membership.findFirst({
    where: {
      id: actor.membershipId,
      userId: actor.userId,
      tenantId: actor.tenantId,
      venueId: actor.venueId,
      active: true,
      role: { in: ["OWNER", "MANAGER"] },
    },
  });
  if (!membership) throw new Error("Media ownership could not be verified.");
  const scope = { tenantId: actor.tenantId, venueId: actor.venueId };
  const prior = await tx.mediaAsset.findUnique({
    where: {
      tenantId_venueId_sourceKey: { ...scope, sourceKey: input.sourceKey },
    },
  });
  if (prior) {
    const saved = prior.provenance as Record<string, unknown>;
    if (
      prior.contentHash !== input.image.contentHash ||
      prior.source !== input.provenance.source ||
      prior.approvedForPublicUse !== input.approvedForPublicUse ||
      Object.keys(saved).length !== Object.keys(input.provenance).length ||
      Object.entries(input.provenance).some(
        ([key, value]) => saved[key] !== value,
      )
    )
      throw new Error(
        "Media import identity conflicts with existing provenance.",
      );
    return prior;
  }
  const asset = await tx.mediaAsset.create({
    data: {
      ...scope,
      ...input.image,
      sourceKey: input.sourceKey,
      source: input.provenance.source,
      provenance: input.provenance,
      approvedForPublicUse: input.approvedForPublicUse,
      createdByUserId: actor.userId,
      approvedByUserId: actor.userId,
    },
  });
  await tx.auditEvent.create({
    data: {
      ...scope,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      action: "CANONICAL_MEDIA_APPROVED",
      entityType: "MediaAsset",
      entityId: asset.id,
      metadata: {
        source: asset.source,
        approvedForPublicUse: asset.approvedForPublicUse,
        contentHash: asset.contentHash,
      },
    },
  });
  return asset;
}
export async function assignCanonicalMedia(
  tx: Prisma.TransactionClient,
  actor: Actor,
  assetId: string,
  target: { productId: string } | { venueRole: "LOGO" | "HERO" | "PROFILE" },
) {
  const scope = { tenantId: actor.tenantId, venueId: actor.venueId };
  await lockCanonicalMedia(tx, scope);
  assertStaffPermission(actor.role, "WEBSITE_MANAGE");
  await tx.membership.findFirstOrThrow({
    where: {
      id: actor.membershipId,
      userId: actor.userId,
      ...scope,
      active: true,
      role: { in: ["OWNER", "MANAGER"] },
    },
  });
  await tx.mediaAsset.findFirstOrThrow({ where: { ...scope, id: assetId } });
  if ("productId" in target) {
    await tx.product.findFirstOrThrow({
      where: { ...scope, id: target.productId },
    });
    const key = {
      ...scope,
      productId: target.productId,
      role: "PRIMARY" as const,
      sortOrder: 0,
    };
    await tx.productMedia.upsert({
      where: { tenantId_venueId_productId_role_sortOrder: key },
      create: { ...key, mediaAssetId: assetId },
      update: { mediaAssetId: assetId },
    });
  } else {
    const key = { ...scope, role: target.venueRole, sortOrder: 0 };
    await tx.venueMedia.upsert({
      where: { tenantId_venueId_role_sortOrder: key },
      create: { ...key, mediaAssetId: assetId },
      update: { mediaAssetId: assetId },
    });
  }
  await tx.auditEvent.create({
    data: {
      ...scope,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      action: "CANONICAL_MEDIA_ASSIGNED",
      entityType: "MediaAsset",
      entityId: assetId,
      metadata: target,
    },
  });
}
export const canonicalMediaRepository = {
  async upload(
    staff: Actor,
    bytes: Buffer,
    target: { productId: string } | { venueRole: "LOGO" | "HERO" | "PROFILE" },
    confirmed: boolean,
  ) {
    const image = await normalizeCanonicalImage(bytes);
    return prisma.$transaction(async (tx) => {
      const asset = await storeCanonicalMedia(tx, staff, {
        image,
        sourceKey: `upload:${image.contentHash}`,
        provenance: {
          source: "UPLOAD",
          description: "Uploaded and explicitly approved by venue staff.",
        },
        approvedForPublicUse: true,
        confirmed,
      });
      await assignCanonicalMedia(tx, staff, asset.id, target);
      return canonicalMediaReference(asset);
    });
  },
  async resolve({ tenantId, venueId }: Scope, publicOnly = false) {
    const scope = { tenantId, venueId };
    const filter = publicOnly ? { approvedForPublicUse: true } : {};
    const [venue, products] = await Promise.all([
      prisma.venueMedia.findMany({
        where: { ...scope, asset: filter },
        include: { asset: { select: mediaMetadataSelect } },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.productMedia.findMany({
        where: { ...scope, role: "PRIMARY", asset: filter },
        include: { asset: { select: mediaMetadataSelect } },
      }),
    ]);
    return {
      venue: venue.map((row) => ({
        role: row.role,
        media: canonicalMediaReference(row.asset),
      })),
      products: products.map((row) => ({
        productId: row.productId,
        media: canonicalMediaReference(row.asset),
      })),
    };
  },
  async content(id: string, scope?: Scope) {
    if (scope) {
      const own = await prisma.mediaAsset.findFirst({
        where: {
          id,
          tenantId: scope.tenantId,
          venueId: scope.venueId,
          venue: { tenant: { retiredAt: null } },
        },
      });
      if (own) return own;
    }
    const asset = await prisma.mediaAsset.findFirst({
      where: {
        id,
        approvedForPublicUse: true,
        venue: {
          tenant: { retiredAt: null },
          website: { status: "PUBLISHED" },
        },
        OR: [
          { venueMedia: { some: {} } },
          { productMedia: { some: { product: { published: true } } } },
        ],
      },
    });
    if (!asset) return null;
    const subscription = await prisma.subscription.findUnique({
      where: { tenantId: asset.tenantId },
      include: { entitlements: true },
    });
    const active =
      subscription?.status === "ACTIVE" ||
      (subscription?.status === "TRIALING" &&
        subscription.trialEndsAt &&
        subscription.trialEndsAt > new Date());
    return active &&
      subscription?.entitlements.some(
        (row) => row.featureKey === "PUBLIC_WEBSITE" && row.enabled,
      )
      ? asset
      : null;
  },
};

// Explicit, idempotent bridge. Existing website bytes are snapshotted by hash,
// never referenced as mutable canonical content. No remote URL fetching.
export async function bridgeWebsiteMedia(staff: Actor) {
  const assets = await prisma.websiteAsset.findMany({
    where: { tenantId: staff.tenantId, venueId: staff.venueId },
  });
  for (const legacy of assets) {
    const assigned = await prisma.venueMedia.findFirst({
      where: {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        role: legacy.kind,
      },
    });
    if (assigned) continue;
    const image = await normalizeCanonicalImage(Buffer.from(legacy.bytes));
    await prisma.$transaction(async (tx) => {
      const asset = await storeCanonicalMedia(tx, staff, {
        image,
        sourceKey: `website:${legacy.id}:${image.contentHash}`,
        provenance: {
          source: "IMPORT",
          description:
            "Existing venue website upload approved by staff for canonical use.",
          originalAssetId: legacy.id,
        },
        approvedForPublicUse: true,
        confirmed: true,
      });
      await assignCanonicalMedia(tx, staff, asset.id, {
        venueRole: legacy.kind,
      });
    });
  }
  return canonicalMediaRepository.resolve(staff);
}
