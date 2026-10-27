import { it, expect } from "vitest";
import { createDesign, type CreativeBinding } from "./creative";
import { validateCreativeSources } from "./creative-source-policy";
import { instantiateCreativeTemplate } from "./creative-templates";
const source: CreativeBinding = {
  id: "price",
  sourceType: "PRODUCT",
  sourceId: "pizza",
  field: "price",
  version: "v1",
  value: "€10.50",
};
it("allows explicit keep/update and rejects invented commercial values and locale reuse", () => {
  const old = { ...createDesign("A4", "en"), bindings: [source] };
  const current = { ...source, value: "€11.00", version: "v2" };
  expect(validateCreativeSources(old, old, [current]).bindings[0]!.value).toBe(
    "€10.50",
  );
  expect(
    validateCreativeSources({ ...old, bindings: [current] }, old, [current])
      .bindings[0]!.value,
  ).toBe("€11.00");
  expect(() =>
    validateCreativeSources(
      { ...old, bindings: [{ ...source, value: "€1.00" }] },
      old,
      [current],
    ),
  ).toThrow();
  expect(() =>
    validateCreativeSources({ ...old, locale: "de" }, old, [current]),
  ).toThrow();
});
it("printed menus use bound product and price layers and contain no invented offers", () => {
  const doc = instantiateCreativeTemplate("Printed menu", "A5", "en", [
    { ...source, id: "name", field: "name", value: "Margherita" },
    source,
  ]);
  expect(doc.pages[0]!.layers.map((l) => l.type)).toEqual(["product", "price"]);
  expect(doc.bindings).toHaveLength(2);
});
