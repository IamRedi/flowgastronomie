import { describe, it, expect } from "vitest";
import {
  createDesign,
  createTextLayer,
  parseDesignDocument,
  adaptDesign,
  sourceChanges,
  applyResolvedBindings,
} from "./creative";
import { hasStaffPermission } from "./staff-permissions";

describe("Creative Studio contract", () => {
  it("round trips our schema and rejects native editor data and future schemas", () => {
    const doc = createDesign("A4", "de");
    expect(parseDesignDocument(doc)).toEqual(doc);
    expect(() => parseDesignDocument({ ...doc, objects: [] })).toThrow();
    expect(() => parseDesignDocument({ ...doc, schemaVersion: 2 })).toThrow();
  });
  it("denies restricted roles at the domain boundary", () => {
    for (const role of ["WAITER", "KITCHEN", "BAR"] as const)
      expect(hasStaffPermission(role, "CREATIVE_EDIT")).toBe(false);
    for (const role of ["OWNER", "MANAGER"] as const)
      expect(hasStaffPermission(role, "CREATIVE_AI_USE")).toBe(true);
  });
  it("rejects duplicate layers, arbitrary colors, fonts, unsafe geometry and unbound prices", () => {
    const doc = createDesign("SOCIAL", "en");
    const layer = createTextLayer("headline");
    for (const bad of [
      { ...layer, x: Infinity },
      { ...layer, font: "https://evil" },
      { ...layer, fill: "url(x)" },
      { ...layer, type: "price" },
    ])
      expect(() =>
        parseDesignDocument({
          ...doc,
          pages: [{ ...doc.pages[0], layers: [bad] }],
        }),
      ).toThrow();
    expect(() =>
      parseDesignDocument({
        ...doc,
        pages: [{ ...doc.pages[0], layers: [layer, layer] }],
      }),
    ).toThrow();
  });
  it("adapts geometry without losing layers", () => {
    const doc = createDesign("SOCIAL", "en");
    doc.pages[0]!.layers.push(createTextLayer("headline"));
    expect(adaptDesign(doc, "A4").pages[0]!.layers[0]!.width).toBeLessThan(500);
    expect(doc.format).toBe("SOCIAL");
  });
  it("detects changed sources and updates explicitly without rewriting the old document", () => {
    const doc = createDesign("A4", "de");
    const binding = {
      id: "price",
      sourceType: "PRODUCT" as const,
      sourceId: "pizza",
      field: "price" as const,
      version: "1",
      value: "10,50 €",
    };
    doc.bindings.push(binding);
    doc.pages[0]!.layers.push({
      ...createTextLayer("price"),
      type: "price",
      bindingId: "price",
      text: binding.value,
    } as never);
    const next = [{ ...binding, value: "11,00 €", version: "2" }];
    expect(sourceChanges(doc, next)).toHaveLength(1);
    expect(applyResolvedBindings(doc, next).bindings[0]!.value).toBe("11,00 €");
    expect(doc.bindings[0]!.value).toBe("10,50 €");
    expect(() => sourceChanges(doc, [])).toThrow("UNRESOLVED_SOURCE");
  });
});
