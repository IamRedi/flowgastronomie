import { createHash } from "node:crypto";
import sharp from "sharp";
// Raster validation/normalization stays behind this adapter. DB bytea is the
// initial immutable storage backend; consumers only receive canonical IDs.
export async function normalizeCanonicalImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024)
    throw new Error("Use an image up to 5 MB.");
  const image = sharp(bytes, {
    limitInputPixels: 25_000_000,
    failOn: "warning",
  });
  const metadata = await image.metadata();
  if (
    !["jpeg", "png", "webp"].includes(metadata.format ?? "") ||
    (metadata.pages ?? 1) !== 1
  )
    throw new Error("Use a static JPEG, PNG or WebP image.");
  const { data, info } = await image
    .rotate()
    .webp({ quality: 92 })
    .toBuffer({ resolveWithObject: true });
  return {
    bytes: Uint8Array.from(data),
    width: info.width,
    height: info.height,
    mimeType: "image/webp",
    contentHash: createHash("sha256").update(data).digest("hex"),
  };
}

// New onboarding uploads keep the exact original bytes. Full decoding checks
// truncated/malformed images; normalization is used only to recognize already
// known canonical content, never to overwrite the uploaded original.
export async function inspectCanonicalUpload(bytes: Buffer) {
  const normalized = await normalizeCanonicalImage(bytes);
  const metadata = await sharp(bytes).metadata();
  return {
    image: {
      bytes: Uint8Array.from(bytes),
      width: normalized.width,
      height: normalized.height,
      mimeType: `image/${metadata.format === "jpeg" ? "jpeg" : metadata.format}`,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
    },
    normalizedHash: normalized.contentHash,
  };
}
