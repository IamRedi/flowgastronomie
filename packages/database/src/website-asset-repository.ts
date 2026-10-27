import { WebsiteAssetKind as DatabaseAssetKind } from "@prisma/client";
import {
  assertStaffPermission,
  isSupportedWebsiteAsset,
  type WebsiteAssetKind,
  type WebsiteAssetMimeType,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import {
  assignCanonicalMedia,
  storeCanonicalMedia,
} from "./canonical-media-repository.js";
import { normalizeCanonicalImage } from "./media-storage-adapter.js";
import type { StaffIdentity } from "./staff-auth-repository.js";
import { subscriptionRepository } from "./subscription-repository.js";

export class WebsiteAssetInvalidError extends Error {
  constructor() {
    super("Upload a JPEG, PNG, or WebP image up to 5 MB");
    this.name = "WebsiteAssetInvalidError";
  }
}

export class WebsiteAssetNotFoundError extends Error {
  constructor() {
    super("The website image was not found");
    this.name = "WebsiteAssetNotFoundError";
  }
}

export type WebsiteAssetRepository = {
  upload(input: {
    staff: StaffIdentity;
    kind: WebsiteAssetKind;
    mimeType: string;
    bytes: Buffer;
  }): Promise<{ id: string; kind: WebsiteAssetKind; url: string }>;
  findPublic(id: string): Promise<{
    mimeType: string;
    bytes: Uint8Array;
    updatedAt: Date;
  } | null>;
};

function hasValidSignature(mimeType: string, bytes: Buffer): boolean {
  if (mimeType === "image/jpeg")
    return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (mimeType === "image/png")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/webp")
    return (
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    );
  return false;
}

export const websiteAssetRepository: WebsiteAssetRepository = {
  async upload({ staff, kind, mimeType, bytes }) {
    assertStaffPermission(staff.role, "WEBSITE_MANAGE");
    await subscriptionRepository.assertFeature(
      staff.tenantId,
      "PUBLIC_WEBSITE",
    );
    if (
      !isSupportedWebsiteAsset(mimeType, bytes.byteLength) ||
      !hasValidSignature(mimeType, bytes)
    ) {
      throw new WebsiteAssetInvalidError();
    }
    const website = await prisma.venueWebsite.findFirst({
      where: { tenantId: staff.tenantId, venueId: staff.venueId },
    });
    if (!website) throw new WebsiteAssetNotFoundError();
    const image = await normalizeCanonicalImage(bytes);
    const asset = await prisma.$transaction(async (transaction) => {
      const saved = await transaction.websiteAsset.upsert({
        where: {
          websiteId_kind: {
            websiteId: website.id,
            kind: kind as DatabaseAssetKind,
          },
        },
        create: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          websiteId: website.id,
          kind: kind as DatabaseAssetKind,
          mimeType,
          byteLength: bytes.byteLength,
          bytes: Uint8Array.from(bytes),
        },
        update: {
          mimeType,
          byteLength: bytes.byteLength,
          bytes: Uint8Array.from(bytes),
        },
      });
      const canonical = await storeCanonicalMedia(transaction, staff, {
        image,
        sourceKey: `website:${saved.id}:${image.contentHash}`,
        provenance: {
          source: "UPLOAD",
          description:
            "Uploaded and approved through the venue website editor.",
          originalAssetId: saved.id,
        },
        approvedForPublicUse: true,
        confirmed: true,
      });
      await assignCanonicalMedia(transaction, staff, canonical.id, {
        venueRole: kind,
      });
      const url = `/v1/media/${canonical.id}`;
      await transaction.venueWebsite.update({
        where: { id: website.id },
        data: kind === "LOGO" ? { logoUrl: url } : { heroImageUrl: url },
      });
      await transaction.auditEvent.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
          action: "WEBSITE_ASSET_UPLOADED",
          entityType: "WebsiteAsset",
          entityId: saved.id,
          metadata: { kind, mimeType, byteLength: bytes.byteLength },
        },
      });
      return { id: canonical.id, url };
    });
    return { id: asset.id, kind, url: asset.url };
  },

  async findPublic(id) {
    const asset = await prisma.websiteAsset.findUnique({
      where: { id },
      include: {
        website: { select: { status: true } },
        tenant: {
          include: { subscription: { include: { entitlements: true } } },
        },
      },
    });
    if (!asset || asset.website.status !== "PUBLISHED") return null;
    const subscription = asset.tenant.subscription;
    const enabled = subscription?.entitlements.some(
      (item) => item.featureKey === "PUBLIC_WEBSITE" && item.enabled,
    );
    const active =
      subscription?.status === "ACTIVE" ||
      (subscription?.status === "TRIALING" &&
        subscription.trialEndsAt !== null &&
        subscription.trialEndsAt > new Date());
    if (!enabled || !active) return null;
    return {
      mimeType: asset.mimeType,
      bytes: asset.bytes,
      updatedAt: asset.updatedAt,
    };
  },
};
