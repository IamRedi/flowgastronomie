import { pdfBusinessFields } from "./business-pdf-identity.js";
import { businessFieldSchema } from "@flowgastronomie/domain";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  SetupImportError,
  validateMenuImportProposal,
  type MenuImportProposal,
  type BusinessField,
  type BusinessImage,
} from "@flowgastronomie/domain";
import {
  ImportNetwork,
  businessImportLimits,
  importUrl,
  boundedPromise,
  type ImportNetworkDependencies,
} from "./business-import-network.js";
import {
  extractBusinessHtml,
  sourceDocument,
  type DiscoverySource,
} from "./business-import-extraction.js";
import { inspectMenuSource } from "./menu-import-document-adapter.js";
import type { MenuExtractionProvider } from "./menu-extraction-provider.js";
import {
  pdfMenuLines,
  extractPdfMenu,
  type PdfMenuLine,
  type PdfMenuToken,
} from "./menu-pdf-layout.js";

export type BusinessDiscoveryResult = {
  fields: BusinessField[];
  images: BusinessImage[];
  menu: MenuImportProposal;
  warnings: string[];
  provenance: Record<string, unknown>;
};
export type IsolatedWebsiteRenderer = (
  url: string,
  html: Buffer,
  network: ImportNetwork,
  signal: AbortSignal,
) => Promise<Buffer>;
export type BusinessDiscoveryDependencies = ImportNetworkDependencies & {
  renderer?: IsolatedWebsiteRenderer;
  provider?: MenuExtractionProvider;
};

export async function readImportPdf(
  bytes: Buffer,
  signal: AbortSignal,
): Promise<string[]> {
  return (await readImportPdfLayout(bytes, signal)).map((lines) =>
    lines.map((l) => l.text).join("\n"),
  );
}
export async function readImportPdfLayout(
  bytes: Buffer,
  signal: AbortSignal,
): Promise<PdfMenuLine[][]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfRoot = dirname(
    createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
  );
  const task = getDocument({
    data: Uint8Array.from(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
    standardFontDataUrl:
      join(pdfRoot, "standard_fonts").replaceAll("\\", "/") + "/",
    wasmUrl: join(pdfRoot, "wasm").replaceAll("\\", "/") + "/",
  });
  try {
    return await boundedPromise(
      (async () => {
        const pdf = await task.promise;
        if (pdf.numPages < 1 || pdf.numPages > 20)
          throw new SetupImportError("LIMIT");
        const pages: PdfMenuLine[][] = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          signal.throwIfAborted();
          const page = await pdf.getPage(n);
          const content = await page.getTextContent();
          if (content.items.length > 10000) throw new SetupImportError("LIMIT");
          const lines = pdfMenuLines(
            content.items.filter((item) => "str" in item) as PdfMenuToken[],
          );
          if (lines.reduce((n, l) => n + l.text.length, 0) > 100_000)
            throw new SetupImportError("LIMIT");
          pages.push(lines);
        }
        return pages;
      })(),
      AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    );
  } finally {
    await task.destroy();
  }
}

export async function discoverBusiness(
  input: {
    url: string | null;
    files: DiscoverySource[];
    locale: "en" | "de" | "it" | "sq";
    requestKey: string;
    signal: AbortSignal;
    saveSource: (source: DiscoverySource) => Promise<void>;
    progress: (message: string) => Promise<void>;
  },
  dependencies: BusinessDiscoveryDependencies = {},
): Promise<BusinessDiscoveryResult> {
  const result: BusinessDiscoveryResult = {
    fields: [],
    images: [],
    menu: { schemaVersion: 1, categories: [], items: [] },
    warnings: [],
    provenance: { deterministic: true, providerCalls: 0 },
  };
  const sources: DiscoverySource[] = [...input.files];
  const unresolved: DiscoverySource[] = [];
  const coverage: Array<{
    sourceId: string;
    page: number;
    textLines: number;
    products: number;
    method: string;
  }> = [];
  result.provenance.coverage = coverage;
  const itemMethods: Record<string, string> = {};
  result.provenance.itemMethods = itemMethods;
  let nextItem = 0;
  const addMenu = (menu: MenuImportProposal, method: string) => {
    const categoryIds = new Map<string, string>();
    for (const category of menu.categories) {
      const existing = result.menu.categories.find(
        (c) =>
          c.name.value?.trim().toLowerCase() ===
          category.name.value?.trim().toLowerCase(),
      );
      if (existing) categoryIds.set(category.id, existing.id);
      else if (result.menu.categories.length < 50) {
        result.menu.categories.push(category);
        categoryIds.set(category.id, category.id);
      }
    }
    for (const item of menu.items) {
      if (
        result.menu.items.length >= 150 ||
        (item.categoryId.value && !categoryIds.has(item.categoryId.value))
      ) {
        result.warnings.push(
          "The review limit was reached. Found items were retained; import remaining items separately.",
        );
        continue;
      }
      // Local provider IDs must not collide with deterministic proposal IDs.
      const id = `item-${nextItem++}`;
      result.menu.items.push({
        ...item,
        id,
        categoryId: {
          ...item.categoryId,
          value: item.categoryId.value
            ? categoryIds.get(item.categoryId.value)!
            : null,
        },
      });
      itemMethods[id] = method;
    }
  };
  const file = async (source: DiscoverySource) => {
    if (source.mimeType === "application/pdf") {
      try {
        const pages = await readImportPdfLayout(source.bytes, input.signal);
        source.pageCount = pages.length;
        const menu = extractPdfMenu(source, pages);
        result.fields.push(...pdfBusinessFields(source, pages));
        pages.forEach((lines, index) =>
          coverage.push({
            sourceId: source.id,
            page: index + 1,
            textLines: lines.length,
            products: menu.items.filter((i) =>
              i.name.evidence.some((e) => e.page === index + 1),
            ).length,
            method: lines.length ? "PDF_TEXT" : "UNREADABLE",
          }),
        );
        // Complete readable rows need no paid enrichment. Missing optional
        // business facts alone are not evidence that they exist in this menu.
        if (
          !menu.items.length ||
          pages.some((page) => !page.length) ||
          menu.items.some((item) =>
            [item.name, item.categoryId, item.priceMinor, item.currency].some(
              (field) => field.value === null,
            ),
          )
        )
          unresolved.push(source);
        if (menu.items.length) addMenu(menu, "PDF_TEXT");
      } catch (error) {
        if (input.signal.aborted) throw error;
        unresolved.push(source);
        result.warnings.push(
          "A PDF could not be read deterministically. Use manual review or an authorized extraction provider.",
        );
      }
    } else unresolved.push(source);
  };
  for (const source of input.files) await file(source);
  if (input.url) {
    const network = new ImportNetwork(input.url, input.signal, dependencies);
    try {
      await network.authorize();
      const queue = [{ url: input.url, depth: 0 }];
      const visited = new Set<string>();
      let documents = 0;
      while (queue.length && visited.size < network.limits.pages) {
        network.signal.throwIfAborted();
        const next = queue.shift()!;
        if (visited.has(next.url)) continue;
        visited.add(next.url);
        try {
          await input.progress(
            `SOURCE ${visited.size}/${network.limits.pages}`,
          );
          const response = await network.get(
            next.url,
            /\.pdf(?:\?|$)/i.test(next.url)
              ? network.limits.fileBytes
              : network.limits.pageBytes,
          );
          const mime = response.type.split(";")[0]!.trim().toLowerCase();
          if (mime === "application/pdf") {
            if (++documents + input.files.length > 4) {
              result.warnings.push(
                "Document limit reached; remaining menus can be uploaded in another import.",
              );
              continue;
            }
            const inspected = await inspectMenuSource(
              response.bytes,
              new URL(response.url).pathname.split("/").pop() ?? "menu.pdf",
              mime,
            );
            const source = {
              ...sourceDocument(
                response.bytes,
                response.url,
                mime,
                "PDF_TEXT",
                inspected.filename,
              ),
              pageCount: inspected.pageCount,
            };
            if (
              sources
                .filter((s) => s.mimeType !== "text/html")
                .reduce((n, s) => n + s.pageCount, 0) +
                source.pageCount >
              20
            ) {
              result.warnings.push(
                "PDF page limit reached; remaining documents require another import.",
              );
              continue;
            }
            sources.push(source);
            await input.saveSource(source);
            await file(source);
            continue;
          }
          if (mime !== "text/html" && mime !== "application/xhtml+xml") {
            result.warnings.push("An unsupported source was skipped.");
            continue;
          }
          const source = sourceDocument(
            response.bytes,
            response.url,
            "text/html",
            "HTML",
          );
          // Validate reuse restrictions before retaining the page or following its links.
          let extracted = extractBusinessHtml(source);
          let menuMethod = extracted.menuMethod;
          sources.push(source);
          await input.saveSource(source);
          extracted = extractBusinessHtml(source);
          if (
            !extracted.menu.items.length &&
            dependencies.renderer &&
            /<script\b(?![^>]*type=["']application\/ld\+json)/i.test(
              response.bytes.toString("utf8"),
            )
          ) {
            try {
              const bytes = await dependencies.renderer(
                response.url,
                response.bytes,
                network,
                network.signal,
              );
              const rendered = sourceDocument(
                bytes,
                response.url,
                "text/html",
                "RENDERED_HTML",
                "rendered page",
              );
              extracted = extractBusinessHtml(rendered);
              menuMethod = "RENDERED_HTML";
              sources.push(rendered);
              await input.saveSource(rendered);
              extracted = extractBusinessHtml(rendered);
            } catch {
              result.warnings.push(
                "JavaScript rendering could not complete safely; the readable source was retained.",
              );
            }
          } else if (
            !extracted.menu.items.length &&
            /<script\b(?![^>]*type=["']application\/ld\+json)/i.test(
              response.bytes.toString("utf8"),
            )
          )
            result.warnings.push(
              "Some content may require isolated JavaScript rendering or a menu file upload.",
            );
          result.fields.push(...extracted.fields);
          result.images.push(...extracted.images);
          result.warnings.push(...extracted.warnings);
          addMenu(extracted.menu, menuMethod);
          if (next.depth < network.limits.depth)
            for (const link of extracted.links) {
              try {
                const parsed = importUrl(link);
                if (
                  parsed.origin === new URL(input.url).origin &&
                  !visited.has(parsed.href) &&
                  queue.length < 50
                )
                  queue.push({ url: parsed.href, depth: next.depth + 1 });
              } catch {
                /* Untrusted links never relax the network policy. */
              }
            }
        } catch (error) {
          if (network.signal.aborted) throw error;
          result.warnings.push(
            error instanceof SetupImportError
              ? error.message
              : "A source could not be read. Add a menu file or enter the missing details.",
          );
        }
      }
      result.provenance.network = {
        requests: network.requests,
        bytes: network.bytes,
      };
    } catch (error) {
      if (input.signal.aborted) throw error;
      result.warnings.push(
        error instanceof SetupImportError
          ? error.message
          : "Discovery timed out or could not read the source. Previously found information is retained.",
      );
    }
  }
  if (
    !result.menu.items.length ||
    ["venueName", "address", "phone", "contactEmail"].some(
      (name) => !result.fields.some((f) => f.field === name),
    )
  )
    for (const source of sources)
      if (
        source.mimeType === "text/html" &&
        !unresolved.some((s) => s.id === source.id)
      )
        unresolved.push(source);
  if (unresolved.length && dependencies.provider) {
    const provider = dependencies.provider;
    const signal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(
        (dependencies.limits ?? businessImportLimits()).providerMs,
      ),
    ]);
    result.provenance.providerCalls = 1;
    try {
      const answer = await boundedPromise(
        provider.extract({
          business: true,
          locale: input.locale,
          sources: unresolved,
          requestKey: input.requestKey,
          signal,
        }),
        signal,
      );
      result.provenance.providerResponse = {
        requestId: answer.requestId,
        usage: answer.usage,
      };
      const aiMenu = validateMenuImportProposal(answer.proposal, unresolved);
      // Keep readable facts when AI coverage is partial. Enrich matching source/name rows once.
      if (aiMenu.items.length) {
        const before = [...result.menu.items];
        addMenu(aiMenu, "AI");
        const normalized = (value: string | null) =>
          value?.trim().toLocaleLowerCase().replace(/\s+/g, " ");
        for (const added of result.menu.items.slice(before.length)) {
          const observed = before.find(
            (item) =>
              normalized(item.name.value) === normalized(added.name.value) &&
              item.name.evidence.some((e) =>
                added.name.evidence.some(
                  (a) => a.sourceId === e.sourceId && a.page === e.page,
                ),
              ),
          );
          if (!observed) continue;
          for (const key of [
            "name",
            "description",
            "categoryId",
            "priceMinor",
            "currency",
          ] as const)
            if (observed[key].value === null)
              Object.assign(observed[key], added[key]);
          if (!observed.variants.length) observed.variants = added.variants;
          if (!observed.modifierGroups.length)
            observed.modifierGroups = added.modifierGroups;
          if (!observed.allergenCandidates.length)
            observed.allergenCandidates = added.allergenCandidates;
          itemMethods[observed.id] = "AI";
          result.menu.items = result.menu.items.filter(
            (item) => item !== added,
          );
        }
      }
      for (const raw of Array.isArray(answer.businessFields)
        ? answer.businessFields
        : []) {
        const parsed = businessFieldSchema.safeParse(raw);
        if (!parsed.success) continue;
        const f = parsed.data,
          source = unresolved.find(
            (s) =>
              s.id === f.evidence.sourceId &&
              s.contentHash === f.evidence.sourceHash,
          );
        if (source && f.value.trim() && f.evidence.excerpt.trim())
          result.fields.push({
            ...f,
            evidence: { ...f.evidence, method: "AI", status: "UNVERIFIED" },
          });
      }
      result.provenance.provider = {
        provider: provider.provider,
        model: provider.model,
        requestId: answer.requestId,
        usage: answer.usage,
        status: "UNVERIFIED",
        sourceHashes: unresolved.map((s) => s.contentHash),
      };
    } catch {
      result.provenance.provider = {
        provider: provider.provider,
        model: provider.model,
        status: "FAILED",
        sourceHashes: unresolved.map((s) => s.contentHash),
      };
      result.warnings.push(
        "The extraction provider could not complete. Review manually; there was no automatic retry.",
      );
    }
  } else if (unresolved.length)
    result.warnings.push(
      "AI is disabled or not authorized. Only readable document text was analyzed; photos/scans and unresolved details need manual review.",
    );
  for (const name of ["venueName", "address", "phone", "contactEmail"])
    if (!result.fields.some((f) => f.field === name))
      result.warnings.push(
        `Business detail not found: ${name}. Existing business data will be retained unless explicitly changed.`,
      );
  for (const page of coverage)
    if (!page.products)
      result.warnings.push(
        `Page ${page.page}: ${page.textLines ? "text read, no menu products identified" : "no readable text; visual extraction required"}.`,
      );
  result.provenance.providerAvailable = !!dependencies.provider;
  input.signal.throwIfAborted();
  result.fields = [
    ...new Map(result.fields.map((f) => [`${f.field}:${f.value}`, f])).values(),
  ].slice(0, 100);
  result.images = [
    ...new Map(result.images.map((i) => [i.url, i])).values(),
  ].slice(0, 50);
  result.warnings = [...new Set(result.warnings)]
    .slice(0, 50)
    .map((w) => w.slice(0, 300));
  validateMenuImportProposal(result.menu, sources);
  result.provenance.sourceDigest = createHash("sha256")
    .update(sources.map((s) => s.contentHash).join(":"))
    .digest("hex");
  return result;
}
