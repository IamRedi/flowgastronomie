import { expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { randomUUID } from "node:crypto";
import { discoverBusiness } from "./business-import-discovery.js";
import { sourceDocument } from "./business-import-extraction.js";
async function pdf() {
  const doc = new PDFDocument({ size: "A4" }),
    chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => {
    doc.on("data", (b) => chunks.push(b));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
  doc.fontSize(24).text("BISTRO GARDEN");
  doc
    .fontSize(12)
    .text("Adresse: Gartenweg 8, 10115 Berlin")
    .text("Telefon: +49 30 555 1234")
    .text("info@garden.example");
  doc.addPage().fontSize(18).text("LUNCH");
  doc
    .fontSize(12)
    .text("Tomato soup 6,50 EUR")
    .text("Seasonal dish PREIS FEHLT");
  doc.end();
  return done;
}
async function discovery(provider?: Parameters<typeof discoverBusiness>[1]) {
  const source = sourceDocument(
    await pdf(),
    null,
    "application/pdf",
    "PDF_TEXT",
    "different-layout.pdf",
  );
  return discoverBusiness(
    {
      url: null,
      files: [source],
      locale: "sq",
      requestKey: randomUUID(),
      signal: AbortSignal.timeout(20000),
      saveSource: async () => {},
      progress: async () => {},
    },
    provider,
  );
}
it("reads identity and contacts independently of products across pages without AI or locale translation", async () => {
  const result = await discovery();
  expect(result.fields.find((f) => f.field === "venueName")?.value).toBe(
    "BISTRO GARDEN",
  );
  expect(result.fields.find((f) => f.field === "phone")?.value).toBe(
    "+49 30 555 1234",
  );
  expect(result.fields.find((f) => f.field === "contactEmail")?.value).toBe(
    "info@garden.example",
  );
  expect(result.fields.find((f) => f.field === "address")?.value).toContain(
    "Gartenweg 8",
  );
  expect(result.provenance.providerCalls).toBe(0);
  expect(result.menu.items).toHaveLength(2);
  expect(result.menu.items[1]!.priceMinor.value).toBeNull();
  expect(result.menu.items[0]!.currency.value).toBe("EUR");
  expect(result.provenance.coverage).toHaveLength(2);
});
it("calls an authorized simulated provider even when structural products exist, without duplicating products or pretending real AI", async () => {
  let calls = 0;
  const result = await discovery({
    provider: {
      provider: "simulated-test-only",
      model: "fixture",
      async extract(input) {
        calls++;
        expect(input.business).toBe(true);
        expect(input.sources).toHaveLength(1);
        return {
          proposal: { schemaVersion: 1, categories: [], items: [] },
          businessFields: [
            {
              id: "bad",
              field: "phone",
              value: "invented",
              evidence: {
                sourceId: "foreign",
                sourceHash: "a".repeat(64),
                sourceUrl: null,
                excerpt: "x",
                method: "AI",
                status: "UNVERIFIED",
                confidence: null,
              },
            },
          ],
          usage: { paidCalls: 0 },
          requestId: "simulated",
        };
      },
    },
  });
  expect(calls).toBe(1);
  expect(result.menu.items).toHaveLength(2);
  expect(result.fields.some((f) => f.value === "invented")).toBe(false);
  expect(result.provenance.providerCalls).toBe(1);
});
it("preserves structural results after provider failure without retry", async () => {
  let calls = 0;
  const result = await discovery({
    provider: {
      provider: "simulated-test-only",
      model: "failure",
      async extract() {
        calls++;
        throw Error("failure");
      },
    },
  });
  expect(calls).toBe(1);
  expect(result.menu.items).toHaveLength(2);
  expect(result.provenance.provider).toMatchObject({ status: "FAILED" });
});
