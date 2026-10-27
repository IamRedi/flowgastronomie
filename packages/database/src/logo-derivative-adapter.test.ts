import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { transparentLogoDerivative } from "./logo-derivative-adapter.js";

it("removes only four-connected near-black border pixels and preserves enclosed black artwork", async () => {
  const width = 9,
    height = 9;
  const data = Buffer.alloc(width * height * 4, 255);
  const set = (x: number, y: number, color: number[]) =>
    data.set(color, (y * width + x) * 4);
  for (let i = 0; i < 9; i++) {
    set(i, 0, [0, 0, 0, 255]);
    set(i, 8, [0, 0, 0, 255]);
    set(0, i, [0, 0, 0, 255]);
    set(8, i, [0, 0, 0, 255]);
  }
  set(1, 1, [25, 25, 25, 255]); // Touches border, removed.
  set(2, 2, [0, 0, 0, 255]); // Diagonal connection only, retained.
  set(4, 4, [0, 0, 0, 255]);
  set(4, 5, [15, 12, 7, 255]);
  set(0, 4, [0, 0, 60, 255]); // Dark colored edge is not black.
  const bytes = await sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  const before = Buffer.from(bytes);
  const result = await transparentLogoDerivative(bytes);
  const actual = await sharp(result.image.bytes).raw().toBuffer();
  expect(bytes.equals(before)).toBe(true);
  expect(result.image.mimeType).toBe("image/png");
  for (const [x, y] of [
    [0, 0],
    [1, 1],
    [8, 8],
  ])
    expect(actual[(y! * width + x!) * 4 + 3]).toBe(0);
  for (const [x, y] of [
    [2, 2],
    [4, 4],
    [4, 5],
    [0, 4],
  ]) {
    const offset = (y! * width + x!) * 4;
    expect(actual.subarray(offset, offset + 4)).toEqual(
      data.subarray(offset, offset + 4),
    );
  }
  await expect(
    transparentLogoDerivative(
      await sharp({
        create: { width: 2, height: 2, channels: 3, background: "black" },
      })
        .png()
        .toBuffer(),
    ),
  ).rejects.toThrow("No foreground");
});

it("preserves every interior artwork pixel of the synthetic JPEG", async () => {
  const bytes = await readFile("../../tests/foundation/synthetic-logo.jpg");
  const source = await sharp(bytes)
    .rotate()
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer();
  const derivative = await transparentLogoDerivative(bytes);
  const actual = await sharp(derivative.image.bytes).raw().toBuffer();
  const { width, height } = derivative.image;
  let changed = 0,
    darkPixels = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if ((x - width / 2) ** 2 + (y - height / 2) ** 2 > 550 ** 2) continue;
      const i = (y * width + x) * 4;
      if (source[i]! < 40 && source[i + 1]! < 40 && source[i + 2]! < 40)
        darkPixels++;
      if (!source.subarray(i, i + 4).equals(actual.subarray(i, i + 4)))
        changed++;
    }
  expect(changed).toBe(0);
  expect(darkPixels).toBeGreaterThan(1000);
  expect(derivative.removedPixels).toBeGreaterThan(100_000);
  expect(actual[3]).toBe(0);
});
