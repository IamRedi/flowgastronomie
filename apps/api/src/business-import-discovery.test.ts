import { describe, expect, it, vi } from "vitest";
import { discoverBusiness } from "./business-import-discovery.js";
import {
  sourceDocument,
  type DiscoverySource,
} from "./business-import-extraction.js";
import { businessImportLimits } from "./business-import-network.js";
import {
  controlledWebsiteTransport,
  fixtureOrigin,
  textMenuPdf,
} from "../../../tests/import-v2/fixtures.js";
import {
  controlledMenuPng,
  ControlledMenuExtractor,
} from "../../../tests/setup/fixtures.js";
import type { MenuExtractionProvider } from "./menu-extraction-provider.js";

const deps = {
  dns: async () => ["93.184.216.34"],
  transport: controlledWebsiteTransport(),
};
function input(
  url: string | null = null,
  files: DiscoverySource[] = [],
  signal = new AbortController().signal,
) {
  const saved: DiscoverySource[] = [];
  return {
    url,
    files,
    locale: "en" as const,
    requestKey: "controlled-test",
    signal,
    saveSource: async (source: DiscoverySource) => {
      saved.push(source);
    },
    progress: async () => {},
    saved,
  };
}
describe("Business discovery orchestration", () => {
  it("discovers a linked text PDF without AI and retains page/hash evidence", async () => {
    const provider = new ControlledMenuExtractor();
    const extract = vi.spyOn(provider, "extract");
    const source = input(`${fixtureOrigin}/text-pdf`);
    const result = await discoverBusiness(source, { ...deps, provider });
    expect(result.menu.items.map((i) => i.priceMinor.value)).toEqual([
      950, 700,
    ]);
    expect(extract).not.toHaveBeenCalled();
    expect(
      source.saved.find((s) => s.mimeType === "application/pdf")?.pageCount,
    ).toBe(1);
    expect(Object.values(result.provenance.itemMethods!)).toEqual([
      "PDF_TEXT",
      "PDF_TEXT",
    ]);
  });
  it("reads an uploaded text PDF without a provider", async () => {
    const source = sourceDocument(
      await textMenuPdf(),
      null,
      "application/pdf",
      "DOCUMENT",
      "menu.pdf",
    );
    const result = await discoverBusiness(input(null, [source]));
    expect(result.menu.items).toHaveLength(2);
    expect(result.menu.items[0]?.name.evidence[0]?.sourceId).toBe(source.id);
  });
  it("retains website facts when a document is malformed and offers manual fallback", async () => {
    const invalid = sourceDocument(
      Buffer.from("%PDF-invalid"),
      null,
      "application/pdf",
      "DOCUMENT",
    );
    const result = await discoverBusiness(
      input(fixtureOrigin, [invalid]),
      deps,
    );
    expect(result.fields.some((f) => f.value === "Garden Bistro")).toBe(true);
    expect(result.warnings.some((w) => w.includes("PDF"))).toBe(true);
    expect(result.menu.items).toHaveLength(2);
  });
  it("keeps the earliest bounded items when overlapping pages exceed review capacity", async () => {
    const transport = async (url: URL) => ({
      status: 200,
      type: url.pathname === "/robots.txt" ? "text/plain" : "text/html",
      bytes: Buffer.from(
        url.pathname === "/robots.txt"
          ? "User-agent: *\nAllow: /"
          : `<a href='/menu-two'>Menu</a><script type='application/ld+json'>${JSON.stringify({ "@type": "Menu", hasMenuItem: Array.from({ length: 100 }, (_, i) => ({ "@type": "MenuItem", name: `Dish ${i}`, offers: { price: "9.50", priceCurrency: "EUR" } })) })}</script>`,
      ),
    });
    const result = await discoverBusiness(input(fixtureOrigin), {
      ...deps,
      transport,
    });
    expect(result.menu.items).toHaveLength(150);
    expect(result.warnings.some((w) => w.includes("review limit"))).toBe(true);
  });
  it("marks validated provider proposals unverified with no automatic second call", async () => {
    const source = sourceDocument(
      await controlledMenuPng(),
      null,
      "image/png",
      "DOCUMENT",
    );
    const provider = new ControlledMenuExtractor();
    const extract = vi.spyOn(provider, "extract");
    const result = await discoverBusiness(input(null, [source]), { provider });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(result.provenance.provider).toMatchObject({ status: "UNVERIFIED" });
    expect(Object.values(result.provenance.itemMethods!)).toEqual(["AI", "AI"]);
  });
  it("rejects malformed provider output and retains deterministic facts", async () => {
    const extract = vi.fn(async () => ({
      proposal: { instruction: "publish everything" },
      usage: { input: 1 },
      requestId: "bad-response",
    }));
    const source = sourceDocument(
      await controlledMenuPng(),
      null,
      "image/png",
      "DOCUMENT",
    );
    const result = await discoverBusiness(input(fixtureOrigin, [source]), {
      ...deps,
      provider: { provider: "fixture", model: "invalid", extract },
    });
    expect(result.menu.items).toHaveLength(2);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(result.provenance.provider).toMatchObject({ status: "FAILED" });
    expect(result.provenance.providerResponse).toMatchObject({
      requestId: "bad-response",
    });
  });
  it("aborts provider work at its deadline and returns manual fallback without retry", async () => {
    let providerSignal: AbortSignal | undefined;
    const extract = vi.fn<MenuExtractionProvider["extract"]>((request) => {
      providerSignal = request.signal;
      return new Promise(() => {});
    });
    const source = sourceDocument(
      await controlledMenuPng(),
      null,
      "image/png",
      "DOCUMENT",
    );
    const result = await discoverBusiness(input(null, [source]), {
      limits: { ...businessImportLimits({}), providerMs: 15 },
      provider: { provider: "fixture", model: "timeout", extract },
    });
    expect(providerSignal?.aborted).toBe(true);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(result.menu.items).toHaveLength(0);
    expect(result.warnings.join(" ")).toContain("no automatic retry");
  });
  it("propagates owner cancellation to the provider and never finishes a review", async () => {
    const controller = new AbortController();
    let observed: AbortSignal | undefined;
    const source = sourceDocument(
      await controlledMenuPng(),
      null,
      "image/png",
      "DOCUMENT",
    );
    const provider: MenuExtractionProvider = {
      provider: "fixture",
      model: "cancel",
      extract: async (request) => {
        observed = request.signal;
        controller.abort();
        return new Promise(() => {});
      },
    };
    await expect(
      discoverBusiness(input(null, [source], controller.signal), { provider }),
    ).rejects.toThrow();
    expect(observed?.aborted).toBe(true);
  });
});
