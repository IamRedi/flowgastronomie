import { it, expect } from "vitest";
import { createDesign, createTextLayer } from "./creative";
import { applyCreativePatch } from "./creative-planner";
it("applies one validated structured patch without mutating the original", () => {
  const document = createDesign("SOCIAL", "en");
  const layer = createTextLayer("headline", "Fresh from our kitchen");
  document.pages[0]!.layers.push(layer);
  const next = applyCreativePatch(
    document,
    {
      summary: "More minimal",
      patches: [
        { op: "replace", layer: { ...layer, fontSize: 40, x: 80 } },
        { op: "format", format: "STORY" },
      ],
    },
    { bindings: [], assetIds: [] },
  );
  expect(next.format).toBe("STORY");
  expect(next.pages[0]!.layers[0]!.x).toBe(80);
  expect(document.pages[0]!.layers[0]!.x).toBe(60);
});
it("blocks invented prices, legal claims, HTML, locked changes and native JSON", () => {
  const doc = createDesign("A4", "en");
  const layer = createTextLayer("headline");
  doc.pages[0]!.layers.push(layer);
  for (const text of [
    "Only €1 today",
    "Certified allergen-free",
    "<script>alert(1)</script>",
    "123 Main Street",
  ])
    expect(() =>
      applyCreativePatch(
        doc,
        {
          summary: "",
          patches: [{ op: "replace", layer: { ...layer, text } }],
        },
        { bindings: [], assetIds: [] },
      ),
    ).toThrow();
  doc.pages[0]!.layers[0]!.locked = true;
  expect(() =>
    applyCreativePatch(
      doc,
      { summary: "", patches: [{ op: "remove", layerId: layer.id }] },
      { bindings: [], assetIds: [] },
    ),
  ).toThrow("Unlock");
  expect(() =>
    applyCreativePatch(doc, { objects: [] }, { bindings: [], assetIds: [] }),
  ).toThrow();
});
it("keeps bound prices authoritative even if the planner supplies alternate text", () => {
  const doc = createDesign("A4", "en");
  const binding = {
    id: "price",
    sourceType: "PRODUCT" as const,
    sourceId: "pizza",
    field: "price" as const,
    version: "1",
    value: "€10.50",
  };
  doc.bindings = [binding];
  const layer = {
    ...createTextLayer("price", binding.value),
    type: "price" as const,
    bindingId: binding.id,
  };
  doc.pages[0]!.layers.push(layer);
  const next = applyCreativePatch(
    doc,
    {
      summary: "",
      patches: [{ op: "replace", layer: { ...layer, text: "€0.01" } }],
    },
    { bindings: [binding], assetIds: [] },
  );
  expect(next.pages[0]!.layers[0]).toMatchObject({ text: "€10.50" });
  expect(() =>
    applyCreativePatch(
      doc,
      {
        summary: "",
        patches: [{ op: "replace", layer: { ...layer, bindingId: null } }],
      },
      { bindings: [binding], assetIds: [] },
    ),
  ).toThrow();
});
