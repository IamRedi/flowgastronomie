import { it, expect } from "vitest";
import sharp from "sharp";
import {
  createDesign,
  createTextLayer,
  creativeFormats,
} from "@flowgastronomie/domain";
import {
  creativeFontHashes,
  creativeHash,
  renderCreative,
  type RenderSnapshot,
} from "./creative-renderer.js";
import { mkdir, writeFile } from "node:fs/promises";
async function fixture(
  format: "A4" | "SOCIAL" = "SOCIAL",
): Promise<RenderSnapshot> {
  const document = createDesign(format, "de");
  const spec = creativeFormats[format];
  document.pages[0]!.layers.push(
    {
      ...createTextLayer("headline", "Frisch aus unserer Küche"),
      width: spec.width - 120,
      height: 160,
      fontSize: 44,
    },
    {
      id: "accent",
      type: "shape",
      name: "Accent",
      x: 60,
      y: 265,
      width: 220,
      height: 8,
      fill: "#b78b52",
      radius: 4,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      bindingId: null,
      groupId: null,
    },
    {
      ...createTextLayer("body", "Margherita\nTomaten, Mozzarella & Basilikum"),
      y: 330,
      width: spec.width - 120,
      height: 190,
      fontSize: 28,
    },
  );
  return {
    rendererVersion: 1,
    document,
    assets: [],
    fontHashes: await creativeFontHashes(document),
    bleed: false,
    cropMarks: false,
  };
}
it("renders exact social PNG/WebP sizes with deterministic bytes and canonical hashes", async () => {
  const snapshot = await fixture();
  const read = async () => Buffer.alloc(0);
  const png = await renderCreative(snapshot, "PNG", read);
  const again = await renderCreative(snapshot, "PNG", read);
  expect(png.equals(again)).toBe(true);
  expect(await sharp(png).metadata()).toMatchObject({
    width: 1080,
    height: 1350,
    format: "png",
  });
  const webp = await renderCreative(snapshot, "WEBP", read);
  expect(await sharp(webp).metadata()).toMatchObject({
    width: 1080,
    height: 1350,
    format: "webp",
  });
  expect(creativeHash({ a: 1, b: 2 })).toBe(creativeHash({ b: 2, a: 1 }));
});
it("creates exact A4 vector PDFs with trim/bleed boxes and matching SVG preview", async () => {
  const snapshot = await fixture("A4");
  const read = async () => Buffer.alloc(0);
  const pdf = await renderCreative(snapshot, "PDF", read);
  const text = pdf.toString("latin1");
  expect(text.startsWith("%PDF-")).toBe(true);
  expect(text).toContain("/MediaBox [0 0 595.275591 841.889764]");
  expect(text).toContain("/TrimBox");
  expect(text).toContain("/BleedBox");
  expect(text).not.toContain("/Subtype /Image");
  const print = await renderCreative(
    { ...snapshot, bleed: true, cropMarks: true },
    "PDF",
    read,
  );
  expect(print.length).toBeGreaterThan(pdf.length);
  const svg = await renderCreative(snapshot, "SVG", read);
  expect(svg.toString()).toContain("<path");
  expect(svg.toString()).not.toContain("<text");
  if (process.env.CREATIVE_WRITE_FIXTURES === "true") {
    await mkdir("../../docs/creative/fixtures", { recursive: true });
    await writeFile("../../docs/creative/fixtures/a4-poster.pdf", pdf);
    await writeFile(
      "../../docs/creative/fixtures/a4-poster.png",
      await sharp(svg).png().toBuffer(),
    );
  }
});
it("blocks text overflow and altered font snapshots", async () => {
  const snapshot = await fixture();
  snapshot.document.pages[0]!.layers[0]!.height = 1;
  await expect(
    renderCreative(snapshot, "PDF", async () => Buffer.alloc(0)),
  ).rejects.toThrow("does not fit");
  snapshot.fontHashes = {};
  await expect(
    renderCreative(snapshot, "PNG", async () => Buffer.alloc(0)),
  ).rejects.toThrow("font version");
});
