import { createHash } from "node:crypto";
import sharp from "sharp";

export const logoDerivativeTransform =
  "EDGE_CONNECTED_BLACK_TO_ALPHA_V1" as const;
export const logoBlackThreshold = 32;

// Four-connected flood fill from the border. Interior dark islands are never
// keyed out; surviving RGB and alpha bytes remain exactly as decoded.
export async function transparentLogoDerivative(bytes: Buffer) {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024)
    throw new Error("Use an original logo up to 5 MB.");
  const image = sharp(bytes, {
    limitInputPixels: 25_000_000,
    failOn: "warning",
  });
  const metadata = await image.metadata();
  if (
    !["jpeg", "png", "webp"].includes(metadata.format ?? "") ||
    (metadata.pages ?? 1) !== 1
  )
    throw new Error("Use a static original logo.");
  const { data, info } = await image
    .rotate()
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const pixels = width * height;
  const visited = new Uint8Array(pixels);
  const queue = new Uint32Array(pixels);
  let head = 0,
    tail = 0;
  const visit = (pixel: number) => {
    if (visited[pixel]) return;
    visited[pixel] = 1;
    const offset = pixel * 4;
    if (
      data[offset + 3] === 0 ||
      Math.max(data[offset]!, data[offset + 1]!, data[offset + 2]!) <=
        logoBlackThreshold
    )
      queue[tail++] = pixel;
  };
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  let removedPixels = 0;
  while (head < tail) {
    const pixel = queue[head++]!;
    const offset = pixel * 4;
    if (data[offset + 3] !== 0) removedPixels++;
    data[offset + 3] = 0;
    const x = pixel % width;
    if (x > 0) visit(pixel - 1);
    if (x < width - 1) visit(pixel + 1);
    if (pixel >= width) visit(pixel - width);
    if (pixel < pixels - width) visit(pixel + width);
  }
  if (tail === pixels) throw new Error("No foreground remains in this logo.");
  const png = await sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  return {
    image: {
      bytes: Uint8Array.from(png),
      width,
      height,
      mimeType: "image/png",
      contentHash: createHash("sha256").update(png).digest("hex"),
    },
    removedPixels,
    inputContentHash: createHash("sha256").update(bytes).digest("hex"),
  };
}
