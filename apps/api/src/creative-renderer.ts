import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import PDFDocument from "pdfkit";
import * as fontkit from "fontkit";
import QRCode from "qrcode";
import sharp from "sharp";
import {
  CreativeError,
  creativeFormats,
  effectiveCreativeLayers,
  type DesignDocument,
  type CreativeLayer,
} from "@flowgastronomie/domain";

const require = createRequire(import.meta.url);
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const creativeHash = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
export type RenderAsset = {
  id: string;
  contentHash: string;
  storageKey: string;
  mimeType: string;
  width: number;
  height: number;
};
export type RenderSnapshot = {
  rendererVersion: 1;
  document: DesignDocument;
  assets: RenderAsset[];
  fontHashes: Record<string, string>;
  bleed: boolean;
  cropMarks: boolean;
};
type Primitive =
  | { kind: "path"; d: string; matrix: number[]; fill: string }
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      radius: number;
      fill: string;
    }
  | {
      kind: "image";
      bytes: Buffer;
      mimeType: string;
      width: number;
      height: number;
    };
type SceneLayer = { layer: CreativeLayer; primitives: Primitive[] };
const fontCache = new Map<string, { font: fontkit.Font; hash: string }>();
async function fontFor(layer: Extract<CreativeLayer, { type: "text" }>) {
  const family = layer.font === "Studio Serif" ? "noto-serif" : "noto-sans";
  const key = `${family}-latin-${layer.weight === "bold" ? 700 : 400}-${layer.italic ? "italic" : "normal"}`;
  if (!fontCache.has(key)) {
    const bytes = await readFile(
      require.resolve(`@fontsource/${family}/files/${key}.woff`),
    );
    fontCache.set(key, {
      font: fontkit.create(bytes) as fontkit.Font,
      hash: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return { key, ...fontCache.get(key)! };
}
export async function creativeFontHashes(document: DesignDocument) {
  const hashes: Record<string, string> = {};
  for (const layer of document.pages[0]!.layers)
    if ("text" in layer) {
      const result = await fontFor({ ...layer, type: "text" });
      hashes[result.key] = result.hash;
    }
  return hashes;
}
async function textPrimitives(
  layer: Extract<CreativeLayer, { type: "text" }>,
): Promise<Primitive[]> {
  const { font } = await fontFor(layer);
  let size = layer.fontSize;
  const width = (text: string) =>
    font
      .layout(text)
      .positions.reduce(
        (sum, p) =>
          sum + (p.xAdvance * size) / font.unitsPerEm + layer.letterSpacing,
        0,
      );
  const wrap = () =>
    layer.text.split("\n").flatMap((paragraph) => {
      const lines: string[] = [];
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && width(candidate) > layer.width) {
          lines.push(line);
          line = word;
        } else line = candidate;
      }
      lines.push(line);
      return lines;
    });
  let lines = wrap();
  while (
    layer.overflow === "shrink" &&
    size > 6 &&
    (lines.length * size * layer.lineHeight > layer.height ||
      lines.some((line) => width(line) > layer.width))
  ) {
    size = Math.max(6, size - 0.5);
    lines = wrap();
  }
  if (
    lines.length * size * layer.lineHeight > layer.height + 0.1 ||
    lines.some((line) => width(line) > layer.width + 0.1)
  )
    throw new CreativeError(
      "INVALID_DESIGN",
      `Text does not fit in “${layer.name}”. Enlarge the text box or shorten the copy.`,
    );
  const primitives: Primitive[] = [];
  lines.forEach((line, index) => {
    const run = font.layout(line);
    let x =
      layer.align === "center"
        ? (layer.width - width(line)) / 2
        : layer.align === "right"
          ? layer.width - width(line)
          : 0;
    const scale = size / font.unitsPerEm;
    run.glyphs.forEach((glyph, i) => {
      const position = run.positions[i]!;
      if (glyph.id === 0)
        throw new CreativeError(
          "INVALID_DESIGN",
          "The selected font does not support a character in this design.",
        );
      const d = glyph.path.toSVG();
      if (d)
        primitives.push({
          kind: "path",
          d,
          matrix: [
            scale,
            0,
            0,
            -scale,
            x + position.xOffset * scale,
            index * size * layer.lineHeight +
              font.ascent * scale -
              position.yOffset * scale,
          ],
          fill: layer.fill,
        });
      x += position.xAdvance * scale + layer.letterSpacing;
    });
  });
  return primitives;
}
async function prepareScene(
  snapshot: RenderSnapshot,
  readAsset: (asset: RenderAsset) => Promise<Buffer>,
): Promise<SceneLayer[]> {
  const result: SceneLayer[] = [];
  for (const layer of effectiveCreativeLayers(snapshot.document)) {
    if (!layer.visible || layer.type === "group") continue;
    let primitives: Primitive[] = [];
    if ("text" in layer)
      primitives = await textPrimitives({ ...layer, type: "text" });
    else if (layer.type === "qr") {
      const binding = snapshot.document.bindings.find(
        (b) => b.id === layer.bindingId,
      );
      if (!binding) throw new CreativeError("UNRESOLVED_SOURCE");
      const qr = QRCode.create(binding.value, { errorCorrectionLevel: "M" });
      const cell = layer.width / (qr.modules.size + 8);
      primitives.push({
        kind: "rect",
        x: 0,
        y: 0,
        width: layer.width,
        height: layer.height,
        radius: 0,
        fill: "#ffffff",
      });
      for (let y = 0; y < qr.modules.size; y++)
        for (let x = 0; x < qr.modules.size; x++)
          if (qr.modules.get(y, x))
            primitives.push({
              kind: "rect",
              x: (x + 4) * cell,
              y: (y + 4) * cell,
              width: cell,
              height: cell,
              radius: 0,
              fill: "#000000",
            });
    } else if ("assetId" in layer) {
      const asset = snapshot.assets.find((a) => a.id === layer.assetId);
      if (!asset) throw new CreativeError("NOT_FOUND");
      const bytes = await readAsset(asset);
      if (
        createHash("sha256").update(bytes).digest("hex") !== asset.contentHash
      )
        throw new CreativeError(
          "INVALID_DESIGN",
          "An image failed its integrity check.",
        );
      const scale =
        snapshot.document.format in creativeFormats &&
        creativeFormats[snapshot.document.format].widthMm
          ? 300 / 96
          : 1;
      const rasterScale = Math.min(
        scale,
        asset.width / layer.width,
        asset.height / layer.height,
      );
      const width = Math.max(
          1,
          Math.min(6000, Math.round(layer.width * rasterScale)),
        ),
        height = Math.max(
          1,
          Math.min(6000, Math.round(layer.height * rasterScale)),
        );
      let image = sharp(bytes);
      if (layer.fit === "cover") {
        const factor = Math.max(width / asset.width, height / asset.height);
        const scaledWidth = Math.max(width, Math.ceil(asset.width * factor)),
          scaledHeight = Math.max(height, Math.ceil(asset.height * factor));
        image = image.resize(scaledWidth, scaledHeight).extract({
          left: Math.round((scaledWidth - width) * layer.focalX),
          top: Math.round((scaledHeight - height) * layer.focalY),
          width,
          height,
        });
      } else
        image = image.resize(width, height, {
          fit: "contain",
          background: "#ffffff00",
        });
      const photographic =
        layer.type === "image" && !(await image.metadata()).hasAlpha;
      const normalized = await (
        photographic
          ? image.jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
          : image.png()
      ).toBuffer();
      primitives = [
        {
          kind: "image",
          bytes: normalized,
          mimeType: photographic ? "image/jpeg" : "image/png",
          width: layer.width,
          height: layer.height,
        },
      ];
    } else if ("fill" in layer)
      primitives = [
        {
          kind: "rect",
          x: 0,
          y: 0,
          width: layer.width,
          height: layer.height,
          radius:
            "radius" in layer
              ? Math.min(layer.radius, layer.width / 2, layer.height / 2)
              : 0,
          fill: layer.fill,
        },
      ];
    result.push({ layer, primitives });
  }
  return result;
}
const number = (value: number) => Number(value.toFixed(5));
function primitiveSvg(p: Primitive) {
  if (p.kind === "path")
    return `<path d="${p.d}" transform="matrix(${p.matrix.map(number).join(" ")})" fill="${p.fill}"/>`;
  if (p.kind === "rect")
    return `<rect x="${number(p.x)}" y="${number(p.y)}" width="${number(p.width)}" height="${number(p.height)}" rx="${p.radius}" fill="${p.fill}"/>`;
  return `<image href="data:${p.mimeType};base64,${p.bytes.toString("base64")}" width="${p.width}" height="${p.height}"/>`;
}
export async function renderCreative(
  snapshot: RenderSnapshot,
  type: "PNG" | "WEBP" | "PDF" | "SVG",
  readAsset: (asset: RenderAsset) => Promise<Buffer>,
) {
  if (
    creativeHash(await creativeFontHashes(snapshot.document)) !==
    creativeHash(snapshot.fontHashes)
  )
    throw new CreativeError(
      "INVALID_DESIGN",
      "The recorded font version is unavailable.",
    );
  const spec = creativeFormats[snapshot.document.format];
  const bleed = snapshot.bleed && spec.widthMm ? (3 * 96) / 25.4 : 0;
  const marks = snapshot.cropMarks && spec.widthMm && type === "PDF" ? 12 : 0;
  const offset = bleed + marks;
  const width = spec.width + offset * 2,
    height = spec.height + offset * 2;
  const scene = await prepareScene(snapshot, readAsset);
  const background = snapshot.document.pages[0]!.background;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="${marks}" y="${marks}" width="${spec.width + bleed * 2}" height="${spec.height + bleed * 2}" fill="${background}"/><g transform="translate(${offset} ${offset})">${scene.map(({ layer: l, primitives }) => `<g transform="translate(${l.x} ${l.y}) rotate(${l.rotation})" opacity="${l.opacity}">${"assetId" in l && l.radius ? `<defs><clipPath id="clip_${l.id}"><rect width="${l.width}" height="${l.height}" rx="${l.radius}"/></clipPath></defs><g clip-path="url(#clip_${l.id})">${primitives.map(primitiveSvg).join("")}</g>` : primitives.map(primitiveSvg).join("")}</g>`).join("")}</g></svg>`;
  if (type === "SVG") return Buffer.from(svg);
  if (type === "PNG" || type === "WEBP") {
    const pixels = sharp(Buffer.from(svg), {
      density: spec.widthMm ? 300 : 96,
    }).resize(
      Math.round(width * (spec.widthMm ? 300 / 96 : 1)),
      Math.round(height * (spec.widthMm ? 300 / 96 : 1)),
    );
    return type === "PNG"
      ? pixels.png().toBuffer()
      : pixels.webp({ quality: 95 }).toBuffer();
  }
  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({
      size: [width * 0.75, height * 0.75],
      margin: 0,
      compress: true,
      info: {
        Producer: "FlowGastronomie Creative Renderer v1",
        CreationDate: new Date("2026-01-01T00:00:00Z"),
        ModDate: new Date("2026-01-01T00:00:00Z"),
      },
    });
    const chunks: Buffer[] = [];
    pdf.on("data", (c) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    pdf.scale(0.75);
    pdf
      .rect(marks, marks, spec.width + bleed * 2, spec.height + bleed * 2)
      .fill(background);
    pdf.translate(offset, offset);
    for (const { layer, primitives } of scene) {
      pdf
        .save()
        .translate(layer.x, layer.y)
        .rotate(layer.rotation)
        .opacity(layer.opacity);
      if ("assetId" in layer && layer.radius)
        pdf.roundedRect(0, 0, layer.width, layer.height, layer.radius).clip();
      for (const p of primitives) {
        if (p.kind === "path") {
          pdf
            .save()
            .transform(
              ...(p.matrix as [number, number, number, number, number, number]),
            )
            .path(p.d)
            .fill(p.fill)
            .restore();
        } else if (p.kind === "rect")
          pdf.roundedRect(p.x, p.y, p.width, p.height, p.radius).fill(p.fill);
        else pdf.image(p.bytes, 0, 0, { width: p.width, height: p.height });
      }
      pdf.restore();
    }
    if (marks) {
      pdf.strokeColor("#000000").lineWidth(0.5);
      for (const x of [0, spec.width])
        for (const y of [0, spec.height]) {
          const sx = x === 0 ? -1 : 1,
            sy = y === 0 ? -1 : 1;
          pdf
            .moveTo(x + sx * (bleed + 2), y)
            .lineTo(x + sx * (bleed + 10), y)
            .stroke();
          pdf
            .moveTo(x, y + sy * (bleed + 2))
            .lineTo(x, y + sy * (bleed + 10))
            .stroke();
        }
    }
    const page = pdf.page as typeof pdf.page & {
      dictionary: { data: Record<string, unknown> };
    };
    page.dictionary.data.TrimBox = [
      offset * 0.75,
      offset * 0.75,
      (offset + spec.width) * 0.75,
      (offset + spec.height) * 0.75,
    ];
    page.dictionary.data.BleedBox = [
      marks * 0.75,
      marks * 0.75,
      (width - marks) * 0.75,
      (height - marks) * 0.75,
    ];
    pdf.end();
  });
}
