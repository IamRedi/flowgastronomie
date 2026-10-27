import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { validateMenuImportProposal } from "@flowgastronomie/domain";
import {
  extractPdfMenu,
  pdfMenuLines,
  type PdfMenuLine,
} from "./menu-pdf-layout.js";
import { sourceDocument } from "./business-import-extraction.js";
import { readImportPdfLayout } from "./business-import-discovery.js";
const line = (
  text: string,
  x: number,
  y: number,
  height = 11,
): PdfMenuLine => ({ text, x, y, height });
const source = sourceDocument(
  Buffer.from("synthetic"),
  null,
  "application/pdf",
  "PDF_TEXT",
);
describe("PDF menu layout", () => {
  it("aligns raised prices with product names next to a third baseline and rejects detached price-only rows", () => {
    const token = (
      str: string,
      x: number,
      y: number,
      height: number,
      width: number,
    ) => ({ str, transform: [height, 0, 0, height, x, y], height, width });
    const rows = pdfMenuLines([
      token("Klein: Ø 26 cm", 345, 649, 9.7, 63),
      token("8,90 € / 11,90 €", 199, 647, 10.4, 74),
      token("Pizza Salami", 42, 646, 11.7, 64),
    ]);
    expect(rows.find((r) => r.x === 42)?.text).toBe(
      "Pizza Salami 8,90 € / 11,90 €",
    );
    const proposal = extractPdfMenu(source, [
      [
        line("PIZZA", 42, 720, 14),
        ...rows,
        line("Groß: Ø 32 cm", 345, 630, 9.7),
        line("Preise: klein / groß", 345, 610, 9.7),
        line("8,90 € / 11,90 €", 42, 500),
      ],
    ]);
    expect(proposal.items).toHaveLength(1);
    expect(proposal.items[0]).toMatchObject({
      name: { value: "Pizza Salami" },
      priceMinor: { value: 890 },
      variants: [
        { priceDeltaMinor: { value: 0 } },
        { priceDeltaMinor: { value: 300 } },
      ],
    });
  });
  it("separates side-by-side headings, descriptions, volume and named price variants", () => {
    const p = validateMenuImportProposal(
      extractPdfMenu(source, [
        [
          line("PIZZA · ZWEI GRÖSSEN", 42, 700, 12),
          line("Klein: Ø 26 cm", 340, 650, 10),
          line("Groß: Ø 32 cm", 340, 630, 10),
          line("Preise: klein / groß", 340, 610, 10),
          line("Pizza Margherita 7,90 € / 10,90 €", 42, 680, 12),
          line("Tomate, Mozzarella", 42, 665, 9),
          line("Pizza Vegetaria PREIS FEHLT", 42, 590, 12),
          line("PASTA", 42, 500),
          line("SALATE", 310, 500),
          line("Penne 8,50 €", 42, 470),
          line("Tomatensauce", 42, 456, 9),
          line("Insalata 6,50 €", 307, 470),
          line("GETRÄNKE", 310, 400),
          line("Cola 0,33 l 2,50 €", 307, 370),
        ],
      ]),
      [source],
    );
    expect(p.items).toHaveLength(5);
    expect(p.items[0]).toMatchObject({
      name: { value: "Pizza Margherita" },
      priceMinor: { value: 790 },
      description: { value: "Tomate, Mozzarella" },
      variants: [
        { name: { value: "Klein Ø 26 cm" }, priceDeltaMinor: { value: 0 } },
        { name: { value: "Groß Ø 32 cm" }, priceDeltaMinor: { value: 300 } },
      ],
    });
    expect(p.items[1]?.priceMinor.value).toBeNull();
    const names = p.categories.map((c) => c.name.value);
    expect(names).toEqual(["PIZZA", "PASTA", "SALATE", "GETRÄNKE"]);
    expect(p.items[4]?.name.value).toBe("Cola 0,33 l");
    expect(p.items[4]?.priceMinor.value).toBe(250);
  });
  it("leaves ambiguous multiple prices empty without observed size definitions", () => {
    const p = extractPdfMenu(source, [
      [line("Pizza 7,90 € / 10,90 €", 42, 700), line("Soup 7.00", 42, 600)],
    ]);
    expect(p.items[0]?.name.value).toBe("Pizza");
    expect(p.items[0]?.priceMinor.value).toBeNull();
    expect(p.items[0]?.variants).toEqual([]);
    expect(p.items[1]?.currency.value).toBeNull();
  });
  it("reads an actual two-column PDF even when its content stream is reordered", async () => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    const bytes = new Promise<Buffer>((resolve, reject) => {
      doc.on("data", (b) => chunks.push(b));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });
    doc.fontSize(12).text("PASTA", 42, 100).text("SALATE", 310, 100);
    doc
      .fontSize(11)
      .text("Penne", 42, 130)
      .fontSize(10)
      .text("8,50 EUR", 220, 130);
    doc.fontSize(9).text("Tomatensauce", 42, 145);
    doc
      .fontSize(11)
      .text("Insalata", 310, 130)
      .fontSize(10)
      .text("6,50 EUR", 480, 130);
    doc.end();
    const b = await bytes,
      s = sourceDocument(b, null, "application/pdf", "PDF_TEXT");
    const p = validateMenuImportProposal(
      extractPdfMenu(
        s,
        await readImportPdfLayout(b, AbortSignal.timeout(15000)),
      ),
      [s],
    );
    expect(p.items.map((i) => i.name.value)).toEqual(["Penne", "Insalata"]);
    expect(p.categories.map((i) => i.name.value)).toEqual(["PASTA", "SALATE"]);
  });
  it("splits two complete product rows at the same vertical coordinate", () => {
    const tokens = [
      { str: "Penne", transform: [1, 0, 0, 1, 42, 700], height: 11, width: 40 },
      {
        str: "8,50 €",
        transform: [1, 0, 0, 1, 220, 700],
        height: 10,
        width: 35,
      },
      {
        str: "Insalata",
        transform: [1, 0, 0, 1, 307, 700],
        height: 11,
        width: 50,
      },
      {
        str: "6,50 €",
        transform: [1, 0, 0, 1, 509, 700],
        height: 10,
        width: 35,
      },
    ];
    expect(pdfMenuLines(tokens.reverse()).map((l) => l.text)).toEqual([
      "Penne 8,50 €",
      "Insalata 6,50 €",
    ]);
  });
  it("does not apply another section's size definitions or merge separately encoded currency", () => {
    const p = extractPdfMenu(source, [
      [
        line("PIZZA", 42, 800),
        line("Klein: 26 cm", 340, 770),
        line("Groß: 32 cm", 340, 750),
        line("Preise: klein / groß", 340, 730),
        line("PASTA", 42, 600),
        line("Penne 7,90 € / 10,90 €", 42, 570),
      ],
    ]);
    expect(p.items[0]?.variants).toEqual([]);
    expect(p.items[0]?.priceMinor.value).toBeNull();
    const tokens = [
      { str: "Soup", transform: [1, 0, 0, 1, 42, 700], height: 11, width: 40 },
      { str: "6,50", transform: [1, 0, 0, 1, 200, 700], height: 11, width: 20 },
      { str: "€", transform: [1, 0, 0, 1, 223, 700], height: 11, width: 8 },
    ];
    expect(pdfMenuLines(tokens).map((l) => l.text)).toEqual(["Soup 6,50 €"]);
  });
});
