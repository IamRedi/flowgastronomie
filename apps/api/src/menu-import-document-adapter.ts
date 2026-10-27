import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { importLimits, SetupImportError } from "@flowgastronomie/domain";
import type { MenuSourceUpload } from "@flowgastronomie/database";
const pdfRoot = dirname(
  createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
);

// Raster previews avoid browser PDF-plugin differences and never execute PDF actions.
export async function renderMenuPdfPage(bytes: Buffer, pageNumber: number) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: Uint8Array.from(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
    standardFontDataUrl:
      join(pdfRoot, "standard_fonts").replaceAll("\\", "/") + "/",
    wasmUrl: join(pdfRoot, "wasm").replaceAll("\\", "/") + "/",
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const pdf = await task.promise;
        if (
          pageNumber < 1 ||
          pageNumber > pdf.numPages ||
          pdf.numPages > importLimits.pages
        )
          throw new SetupImportError("INVALID_INPUT");
        const page = await pdf.getPage(pageNumber);
        const natural = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: Math.min(1400 / natural.width, 1800 / natural.height, 2),
        });
        type CanvasEntry = {
          canvas: HTMLCanvasElement & { toBuffer(format: "image/png"): Buffer };
          context: CanvasRenderingContext2D;
        };
        const factory = pdf.canvasFactory as {
          create(width: number, height: number): CanvasEntry;
          destroy(entry: CanvasEntry): void;
        };
        const entry = factory.create(
          Math.ceil(viewport.width),
          Math.ceil(viewport.height),
        );
        try {
          await page.render({
            canvas: entry.canvas,
            canvasContext: entry.context,
            viewport,
          }).promise;
          return entry.canvas.toBuffer("image/png");
        } finally {
          factory.destroy(entry);
        }
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new SetupImportError(
                "UNAVAILABLE",
                "PDF preview timed out. Open the original file.",
              ),
            ),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await task.destroy();
  }
}

// Untrusted document decoding stays outside domain/repository code.
export async function inspectMenuSource(
  bytes: Buffer,
  filename: string,
  declaredMime: string,
): Promise<MenuSourceUpload> {
  if (!bytes.length || bytes.length > importLimits.fileBytes)
    throw new SetupImportError(
      "INVALID_INPUT",
      "Use a non-empty menu file up to 10 MB.",
    );
  const safeName =
    filename.replace(/[\\/\x00-\x1f\x7f]/g, "_").slice(0, 180) || "menu";
  const base = {
    filename: safeName,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    bytes,
    byteSize: bytes.length,
  };
  if (bytes.subarray(0, 5).toString() === "%PDF-") {
    if (declaredMime !== "application/pdf")
      throw new SetupImportError(
        "INVALID_INPUT",
        "File type does not match its content.",
      );
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      data: Uint8Array.from(bytes),
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: true,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const pdf = await Promise.race([
        task.promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("PDF timeout")), 10_000);
        }),
      ]);
      if (pdf.numPages < 1 || pdf.numPages > importLimits.pages)
        throw new Error("Page limit");
      return {
        ...base,
        mimeType: "application/pdf",
        width: 0,
        height: 0,
        pageCount: pdf.numPages,
      };
    } catch {
      throw new SetupImportError(
        "INVALID_INPUT",
        "Use an unlocked, valid PDF with at most twenty pages.",
      );
    } finally {
      clearTimeout(timer);
      await task.destroy();
    }
  }
  try {
    const decoder = sharp(bytes, {
      limitInputPixels: 20_000_000,
      failOn: "warning",
    });
    const metadata = await decoder.metadata();
    const mime = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[
      metadata.format as "jpeg" | "png" | "webp"
    ];
    if (
      !mime ||
      mime !== declaredMime ||
      (metadata.pages ?? 1) !== 1 ||
      !metadata.width ||
      !metadata.height
    )
      throw new Error("Unsupported image");
    // Force full decode, so truncated/header-only images cannot enter provenance.
    await decoder
      .resize({ width: 32, height: 32, fit: "inside" })
      .png()
      .toBuffer();
    const rotated = (metadata.orientation ?? 1) >= 5;
    return {
      ...base,
      mimeType: mime,
      width: rotated ? metadata.height : metadata.width,
      height: rotated ? metadata.width : metadata.height,
      pageCount: 1,
    };
  } catch {
    throw new SetupImportError(
      "INVALID_INPUT",
      "Upload a valid JPEG, PNG, WebP photo/scan or PDF menu.",
    );
  }
}
