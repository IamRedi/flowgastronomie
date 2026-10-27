import { it, expect } from "vitest";
import { compareMenuImport } from "./menu-import-comparison";
it("compares names, prices, variants, ambiguity and absences without assigning destructive actions", () => {
  const products = [
    {
      id: "a",
      priceMinor: 500,
      currency: "EUR",
      translations: [{ name: "Coffee" }],
    },
    {
      id: "b",
      priceMinor: 800,
      currency: "EUR",
      translations: [{ name: "Cake" }],
    },
    {
      id: "c",
      priceMinor: 100,
      currency: "EUR",
      translations: [{ name: "Absent" }],
    },
  ];
  const result = compareMenuImport(
    [
      {
        id: "1",
        item: {
          name: " COFFEE ",
          priceMinor: 600,
          currency: "EUR",
          variants: [{}],
        },
      },
      { id: "2", item: { name: "Cake", priceMinor: 800, currency: "EUR" } },
      { id: "3", item: { name: "Tea", priceMinor: null, currency: "EUR" } },
      { id: "4", item: { name: "Tea", priceMinor: 200, currency: "EUR" } },
    ],
    products,
  );
  expect(result.items.map((i) => i.kind)).toEqual([
    "PRICE_CHANGED",
    "EXISTING",
    "REVIEW",
    "REVIEW",
  ]);
  expect(result.items[0]?.variants).toBe(1);
  expect(result.absent).toEqual(["c"]);
  expect(products).toHaveLength(3);
  expect(
    compareMenuImport(
      [{ id: "1", item: { name: "New", priceMinor: 200, currency: "EUR" } }],
      products,
    ).items[0]?.kind,
  ).toBe("NEW");
});
