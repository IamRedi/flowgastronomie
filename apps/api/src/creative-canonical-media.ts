import { CreativeError, type CreativeScope } from "@flowgastronomie/domain";
import {
  prisma,
  creativeScope,
  creativeJson,
  storeCanonicalMedia,
  assignCanonicalMedia,
  normalizeCanonicalImage,
  creativeRepository,
} from "@flowgastronomie/database";
import { creativeStorage } from "./creative-storage.js";
import { createHash } from "node:crypto";
export function isCanonicalReviewAsset(asset: { provenance: unknown }) {
  const p = asset.provenance as Record<string, unknown> | null;
  return (
    !!p && typeof p.canonicalMediaId === "string" && p.internalReview === true
  );
}
export async function importCanonicalCreativeAsset(
  staff: CreativeScope,
  id: string,
  catalog: { kind: string; productId: string | null },
) {
  const scope = creativeScope(staff);
  const asset = await prisma.mediaAsset.findFirst({ where: { ...scope, id } });
  if (!asset) throw new CreativeError("NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    const key = `canonical:${asset.id}:${asset.contentHash}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const previous = await tx.creativeAsset.findFirst({
      where: { ...scope, storageKey: key },
    });
    if (previous) return previous;
    return tx.creativeAsset.create({
      data: {
        ...scope,
        name: catalog.kind === "LOGO" ? "Venue logo" : "Product image",
        source: "VENUE_LIBRARY",
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        contentHash: asset.contentHash,
        storageKey: key,
        approvedForPublicUse: asset.approvedForPublicUse,
        approvedBy: asset.approvedByUserId,
        createdBy: staff.userId,
        provenance: creativeJson({
          canonicalMediaId: asset.id,
          source: asset.source,
          original: asset.provenance,
          internalReview: !asset.approvedForPublicUse,
          catalog,
        }),
      },
    });
  });
}
export async function promoteCreativeMedia(
  staff: CreativeScope & { membershipId: string },
  id: string,
  target: { productId: string } | { venueRole: "LOGO" | "HERO" | "PROFILE" },
  approved: boolean,
) {
  if (!approved) throw new CreativeError("UNAPPROVED_ASSET");
  const original = await creativeRepository.asset(staff, id);
  if (
    original.source === "VENUE_LIBRARY" ||
    (original.source === "GENERATED" &&
      "venueRole" in target &&
      target.venueRole === "LOGO")
  )
    throw new CreativeError("INVALID_DESIGN");
  const p = original.provenance as Record<string, unknown>;
  const provenance =
    original.source === "GENERATED"
      ? {
          source: "GENERATED" as const,
          description:
            "Explicitly promoted Creative Studio illustration; not a real venue photograph.",
          originalAssetId: original.id,
          provider: String(p.provider ?? ""),
          model: String(p.model ?? ""),
          promptHash: createHash("sha256")
            .update(String(p.prompt ?? ""))
            .digest("hex"),
        }
      : {
          source: "UPLOAD" as const,
          description:
            "Creative Studio upload explicitly approved as canonical venue/product media.",
          originalAssetId: original.id,
        };
  const image = await normalizeCanonicalImage(
    await creativeStorage.read(original.storageKey),
  );
  return prisma.$transaction(async (tx) => {
    const asset = await storeCanonicalMedia(tx, staff, {
      image,
      sourceKey: `creative:${original.id}:${image.contentHash}`,
      provenance,
      approvedForPublicUse: true,
      confirmed: approved,
    });
    await assignCanonicalMedia(tx, staff, asset.id, target);
    return { mediaAssetId: asset.id };
  });
}
