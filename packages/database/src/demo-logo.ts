import {
  assertFoundationLocalEnvironment,
  assertStaffPermission,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import { normalizeCanonicalImage } from "./media-storage-adapter.js";
import {
  storeCanonicalMedia,
  assignCanonicalMedia,
} from "./canonical-media-repository.js";
import {
  transparentLogoDerivative,
  logoDerivativeTransform,
  logoBlackThreshold,
} from "./logo-derivative-adapter.js";
import type { StaffIdentity } from "./staff-auth-repository.js";

// Explicit local maintenance operation. It never rewrites an original asset or
// applies the derivative to a real/public tenant.
export async function deriveDemoLogo(
  staff: StaffIdentity,
  originalAssetId: string,
  originalBytes: Buffer,
  env = process.env,
) {
  assertFoundationLocalEnvironment(env);
  assertStaffPermission(staff.role, "WEBSITE_MANAGE");
  const scope = { tenantId: staff.tenantId, venueId: staff.venueId };
  const original = await prisma.mediaAsset.findFirstOrThrow({
    where: {
      ...scope,
      id: originalAssetId,
      source: { in: ["IMPORT", "UPLOAD"] },
      venue: { tenant: { kind: "DEMO", retiredAt: null } },
    },
  });
  // Verify the original JPEG supplied by the canonical import lineage, rather
  // than deriving from a lossy re-encoding or an unrelated local file.
  if (
    (await normalizeCanonicalImage(originalBytes)).contentHash !==
    original.contentHash
  )
    throw new Error("Original logo bytes do not match the canonical source.");
  const result = await transparentLogoDerivative(originalBytes);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`logo-derivative:${staff.venueId}`}, 0))`;
    const current = await tx.venueMedia.findFirstOrThrow({
      where: { ...scope, role: "LOGO", sortOrder: 0 },
      include: { asset: true },
    });
    if (
      current.mediaAssetId !== original.id &&
      (current.asset.provenance as Record<string, unknown>)?.originalAssetId !==
        original.id
    )
      throw new Error(
        "Canonical logo changed; review its source before deriving.",
      );
    const derivative = await storeCanonicalMedia(tx, staff, {
      image: result.image,
      sourceKey: `logo-derivative:${original.id}:${result.inputContentHash}:v1`,
      provenance: {
        source: "IMPORT",
        originalAssetId: original.id,
        originalContentHash: original.contentHash,
        inputContentHash: result.inputContentHash,
        transformation: logoDerivativeTransform,
        description: `Synthetic demo transparent PNG. Only edge-connected black pixels (RGB <= ${logoBlackThreshold}, four-connected) removed: ${result.removedPixels}. Interior artwork is preserved. Original immutable.`,
      },
      approvedForPublicUse: false,
      confirmed: true,
    });
    if (current.mediaAssetId !== derivative.id)
      await assignCanonicalMedia(tx, staff, derivative.id, {
        venueRole: "LOGO",
      });
    return derivative;
  });
}
