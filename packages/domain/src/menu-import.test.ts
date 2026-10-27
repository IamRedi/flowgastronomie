import { describe, it, expect } from "vitest";
import {
  importCommitSchema,
  importPriceMinor,
  importPriceText,
  importSessionStatus,
  menuDuplicateCandidates,
  reviewFromProposal,
  validateMenuImportProposal,
  validateReviewedMenuItem,
  type MenuImportProposal,
} from "./menu-import";
const evidence = {
  sourceId: "source",
  page: 1,
  quote: "Pizza Margherita 9.50 EUR",
  box: { x: 0, y: 0, width: 1, height: 1 },
};
const observed = <T>(value: T | null) => ({
  value,
  confidence: value === null ? null : 0.9,
  evidence: value === null ? [] : [evidence],
});
function proposal(): MenuImportProposal {
  return {
    schemaVersion: 1,
    categories: [{ id: "pizza", name: observed("Pizza") }],
    items: [
      {
        id: "one",
        categoryId: observed("pizza"),
        name: observed("Margherita"),
        description: observed<string>(null),
        priceMinor: observed(950),
        currency: observed("EUR"),
        variants: [],
        modifierGroups: [],
        allergenCandidates: [observed("MILK" as const)],
      },
    ],
  };
}
const sources = [
  {
    id: "source",
    pageCount: 1,
    contentHash: "hash",
    mimeType: "image/png",
    filename: "menu.png",
  },
];
describe("Menu import review invariants", () => {
  it("keeps absent facts empty and candidates unapproved", () => {
    const p = proposal();
    p.items[0]!.priceMinor = observed<number>(null);
    const valid = validateMenuImportProposal(p, sources);
    const review = reviewFromProposal(valid.items[0]!, valid);
    expect(review.priceMinor).toBeNull();
    expect(review.approvedAllergens).toEqual([]);
    expect(() => validateReviewedMenuItem(review, "EUR", [])).toThrow("Review");
  });
  it("rejects foreign source, wrong page, missing evidence and out-of-page coordinates", () => {
    for (const replacement of [
      { ...evidence, sourceId: "foreign" },
      { ...evidence, page: 2 },
      { ...evidence, box: { x: 0.5, y: 0, width: 1, height: 1 } },
    ]) {
      const p = proposal();
      p.items[0]!.name.evidence = [replacement];
      expect(() => validateMenuImportProposal(p, sources)).toThrow();
    }
    const p = proposal();
    p.items[0]!.name.evidence = [];
    expect(() => validateMenuImportProposal(p, sources)).toThrow("evidence");
  });
  it("rejects prices without a quoted number and unknown tax fields", () => {
    const p = proposal();
    p.items[0]!.priceMinor.evidence = [{ ...evidence, quote: "ask staff" }];
    expect(() => validateMenuImportProposal(p, sources)).toThrow("numeric");
    expect(() =>
      validateMenuImportProposal({ ...proposal(), taxRate: 19 }, sources),
    ).toThrow();
    const mismatch = proposal();
    mismatch.items[0]!.priceMinor.value = 2000;
    expect(() => validateMenuImportProposal(mismatch, sources)).toThrow(
      "quoted source",
    );
  });
  it("rejects duplicate local IDs and undeclared category references", () => {
    const p = proposal();
    p.items.push(p.items[0]!);
    expect(() => validateMenuImportProposal(p, sources)).toThrow("Duplicate");
    const q = proposal();
    q.items[0]!.categoryId.value = "missing";
    expect(() => validateMenuImportProposal(q, sources)).toThrow("category");
  });
  it("requires venue currency, explicit duplicate decision, and valid options", () => {
    const p = proposal();
    const item = reviewFromProposal(p.items[0]!, p);
    expect(() => validateReviewedMenuItem(item, "ALL", [])).toThrow();
    expect(() => validateReviewedMenuItem(item, "EUR", [{}])).toThrow(
      "similar",
    );
    expect(
      validateReviewedMenuItem(
        { ...item, duplicateAcknowledged: true },
        "EUR",
        [{}],
      ).item.name,
    ).toBe("Margherita");
    expect(() =>
      validateReviewedMenuItem(
        {
          ...item,
          variants: [{ name: "Large", priceDeltaMinor: null, isDefault: true }],
        },
        "EUR",
        [],
      ),
    ).toThrow();
    expect(() =>
      validateReviewedMenuItem(
        {
          ...item,
          modifierGroups: [
            { name: "Extra", minSelect: 2, maxSelect: 1, options: [] },
          ],
        },
        "EUR",
        [],
      ),
    ).toThrow();
  });
  it("supports explicit options and allergens without modifying the proposal", () => {
    const p = proposal();
    const item = reviewFromProposal(p.items[0]!, p);
    const approved = {
      ...item,
      priceMinor: 1050,
      approvedAllergens: ["MILK" as const],
      variants: [
        { name: "Normal", priceDeltaMinor: 0, isDefault: true },
        { name: "Large", priceDeltaMinor: 300, isDefault: false },
      ],
      modifierGroups: [
        {
          name: "Extras",
          minSelect: 0,
          maxSelect: 1,
          options: [{ name: "Olives", priceDeltaMinor: 100 }],
        },
      ],
    };
    expect(
      validateReviewedMenuItem(approved, "EUR", []).configuration.variants,
    ).toHaveLength(2);
    expect(p.items[0]!.priceMinor.value).toBe(950);
  });
  it("finds unicode duplicate candidates without merging or price assumptions", () => {
    const p = proposal();
    const item = {
      ...reviewFromProposal(p.items[0]!, p),
      name: "Ëmbëlsirë çokollate",
    };
    const products = [
      { id: "a", names: ["ËMBËLSIRË ÇOKOLLATE"], priceMinor: 500 },
      { id: "b", names: ["Pizza"], priceMinor: 500 },
    ];
    expect(menuDuplicateCandidates(item, products)).toEqual([
      { id: "a", name: "ËMBËLSIRË ÇOKOLLATE", priceMinor: 500 },
    ]);
    expect(products).toHaveLength(2);
  });
  it("all rows must have decisions; editing invalidates approval; commit needs explicit confirmation", () => {
    expect(importSessionStatus(["APPROVED", "NEEDS_REVIEW"])).toBe(
      "NEEDS_REVIEW",
    );
    expect(importSessionStatus(["APPROVED", "REJECTED"])).toBe("APPROVED");
    expect(importSessionStatus(["IMPORTED", "REJECTED"])).toBe("IMPORTED");
    expect(importSessionStatus(["REJECTED"])).toBe("REJECTED");
    expect(() =>
      importCommitSchema.parse({ expectedVersion: 1, confirm: false }),
    ).toThrow();
  });
  it("uses canonical hundredths for EUR/ALL regardless of Intl display defaults", () => {
    expect(importPriceMinor("9,50", "EUR")).toBe(950);
    expect(importPriceMinor("1200", "ALL")).toBe(120000);
    expect(importPriceText(120000, "ALL")).toBe("1200.00");
    expect(importPriceMinor("100", "JPY")).toBe(10000);
    expect(importPriceMinor("", "EUR")).toBeNull();
    for (const [value, currency] of [
      ["9.555", "EUR"],
      ["1,200.00", "EUR"],
      ["-1", "EUR"],
    ])
      expect(() => importPriceMinor(value!, currency!)).toThrow();
  });
});
