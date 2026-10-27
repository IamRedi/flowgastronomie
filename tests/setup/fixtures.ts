import sharp from "sharp";
import PDFDocument from "pdfkit";
import type {
  MenuExtractionProvider,
  MenuExtractionInput,
} from "../../apps/api/src/menu-extraction-provider.js";
export const controlledMenuSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1100"><rect width="900" height="1100" fill="#fcf7e9"/><rect x="45" y="45" width="810" height="1010" rx="12" fill="none" stroke="#2e513b" stroke-width="3"/><text x="90" y="160" font-size="44" fill="#2e513b" font-family="sans-serif">MENU IMPORT · TEST FIXTURE</text><text x="90" y="250" font-size="34" fill="#2e513b" font-family="sans-serif">Pizza</text><text x="90" y="340" font-size="28" font-family="sans-serif">Margherita test .......... 9.50 EUR</text><text x="90" y="405" font-size="23" font-family="sans-serif">Tomato, mozzarella, basil</text><text x="90" y="500" font-size="23" font-family="sans-serif">Regular 9.50 · Large 12.50 EUR</text><text x="90" y="565" font-size="23" font-family="sans-serif">Extra olives +1.00 EUR (optional, max 1)</text><text x="90" y="630" font-size="23" font-family="sans-serif">Allergens: MILK, GLUTEN</text><text x="90" y="770" font-size="24" font-family="sans-serif">Seasonal special .......... ask staff</text><text x="90" y="970" font-size="18" fill="#755c33" font-family="sans-serif">Controlled sample only. Not a venue's actual menu.</text></svg>`;
export async function controlledMenuPng() {
  return sharp(Buffer.from(controlledMenuSvg)).png().toBuffer();
}
export async function controlledMenuPdf() {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.image(await controlledMenuPng(), 40, 40, { fit: [515, 760] });
  doc.end();
  return done;
}
export function controlledProposal(input: MenuExtractionInput) {
  const sourceId = input.sources[0]!.id;
  const field = <T>(value: T | null, quote: string) => ({
    value,
    confidence: value === null ? 0 : 0.93,
    evidence:
      value === null
        ? []
        : [
            {
              sourceId,
              page: 1,
              quote,
              box: { x: 0.1, y: 0.2, width: 0.8, height: 0.5 },
            },
          ],
  });
  const item = {
    id: "margherita",
    categoryId: field("pizza", "Pizza"),
    name: field("Margherita test", "Margherita test"),
    description: field(
      "Tomato, mozzarella, basil",
      "Tomato, mozzarella, basil",
    ),
    priceMinor: field(950, "9.50 EUR"),
    currency: field("EUR", "EUR"),
    variants: [
      {
        name: field("Regular", "Regular 9.50"),
        priceDeltaMinor: field(0, "Regular 9.50; base 9.50 EUR"),
      },
      {
        name: field("Large", "Large 12.50"),
        priceDeltaMinor: field(300, "Large 12.50; base 9.50 EUR"),
      },
    ],
    modifierGroups: [
      {
        name: field("Extras", "Extra olives"),
        minSelect: field(0, "optional"),
        maxSelect: field(1, "max 1"),
        options: [
          {
            name: field("Olives", "olives"),
            priceDeltaMinor: field(100, "+1.00 EUR"),
          },
        ],
      },
    ],
    allergenCandidates: [field("MILK", "MILK"), field("GLUTEN", "GLUTEN")],
  };
  return {
    schemaVersion: 1,
    categories: [{ id: "pizza", name: field("Pizza", "Pizza") }],
    items: [
      item,
      {
        ...item,
        id: "seasonal",
        name: field("Seasonal special", "Seasonal special"),
        description: field<string>(null, ""),
        priceMinor: field<number>(null, ""),
        variants: [],
        modifierGroups: [],
        allergenCandidates: [],
      },
    ],
  };
}
export class ControlledMenuExtractor implements MenuExtractionProvider {
  readonly provider = "controlled-test";
  readonly model = "menu-fixture-v1";
  calls = 0;
  async extract(input: MenuExtractionInput) {
    this.calls++;
    return {
      proposal: controlledProposal(input),
      usage: { paidCalls: 0 },
      requestId: `fixture-${input.requestKey}`,
    };
  }
}
