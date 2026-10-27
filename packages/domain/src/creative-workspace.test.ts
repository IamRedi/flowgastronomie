import { expect, it } from "vitest";
import {
  composeCreativeBrief,
  creativeRequestedCopy,
  creativeArchiveState,
  creativeBriefSchema,
  creativeMentionedProducts,
} from "./creative-workspace";
import { creativeFormats, type CreativeBinding } from "./creative";
import { applyCreativePatch } from "./creative-planner";
const binding = (id: string, field: "name" | "price"): CreativeBinding => ({
  id: `${id}_${field}`,
  sourceType: "PRODUCT",
  sourceId: id,
  field,
  value: field === "price" ? "€12.00" : `Product ${id}`,
  version: "v1",
});
it("recognizes named products without inventing or loosely matching new products", () => {
  const products = [
    { id: "pizza", name: "Margherita" },
    { id: "dessert", name: "Tiramisù" },
    { id: "ham", name: "Ham" },
  ];
  expect(
    creativeMentionedProducts(
      "Broshurë për Margherita dhe tiramisu!",
      products,
    ),
  ).toEqual(["pizza", "dessert"]);
  expect(creativeMentionedProducts("Champagne", products)).toEqual([]);
});
it("authorizes only explicitly requested discount copy, without changing source prices", () => {
  expect(creativeRequestedCopy("make a sticker me 10%ulje", "sq")).toEqual([
    "10%",
    "10% ulje",
  ]);
  for (const request of [
    "discount 110%",
    "10.5% off",
    "0% off",
    "make it beautiful",
  ])
    expect(creativeRequestedCopy(request, "en")).toEqual([]);
  const doc = composeCreativeBrief(
    creativeBriefSchema.parse({
      material: "STICKER",
      locale: "sq",
      instruction: "10%ulje",
      campaignText: "",
      productIds: ["pizza"],
      assetIds: [],
    }),
    [binding("pizza", "name"), binding("pizza", "price")],
    [],
  );
  expect(doc.pages[0]!.layers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ text: "10% ulje", bindingId: null }),
    ]),
  );
  const headline = doc.pages[0]!.layers.find((l) => l.id === "headline")!;
  expect(() =>
    applyCreativePatch(
      doc,
      {
        summary: "Invent a claim",
        patches: [
          { op: "replace", layer: { ...headline, text: "50% off everything" } },
        ],
      },
      { bindings: doc.bindings, assetIds: [] },
    ),
  ).toThrow("approved phrases");
});
it("fits a full 40 item menu in editable source-backed columns and keeps QR inside the safe area", () => {
  const bindings = Array.from({ length: 40 }, (_, i) => [
    binding(`p${i}`, "name"),
    binding(`p${i}`, "price"),
  ]).flat();
  bindings.push({
    id: "qr",
    sourceType: "QR",
    sourceId: "website",
    field: "destination",
    value: "https://example.test/en/venue/test",
    version: "v1",
  });
  const doc = composeCreativeBrief(
    {
      material: "MENU",
      locale: "en",
      instruction: "",
      campaignText: "",
      productIds: [],
      assetIds: [],
    },
    bindings,
    [],
  );
  expect(doc.pages[0]!.layers.filter((l) => l.type === "price")).toHaveLength(
    40,
  );
  for (const layer of doc.pages[0]!.layers) {
    expect(layer.x).toBeGreaterThanOrEqual(creativeFormats.A4.safe);
    expect(layer.y + layer.height).toBeLessThanOrEqual(
      creativeFormats.A4.height - creativeFormats.A4.safe,
    );
  }
  expect(doc.bindings).toHaveLength(81);
});
it("uses approved asset ids as independent photo layers and never flattens the composition", () => {
  const doc = composeCreativeBrief(
    {
      material: "BROCHURE",
      locale: "en",
      instruction: "",
      campaignText: "Welcome",
      productIds: [],
      assetIds: ["photo"],
    },
    [binding("pizza", "name"), binding("pizza", "price")],
    [{ id: "photo", kind: "VENUE" }],
  );
  expect(doc.pages[0]!.layers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "image", assetId: "photo" }),
      expect.objectContaining({ type: "price", text: "€12.00" }),
    ]),
  );
});
it("uses a premium single-product hero composition instead of list rows", () => {
  const doc = composeCreativeBrief(
    {
      material: "BROCHURE",
      locale: "sq",
      instruction: "Broshurë elegante për Margherita",
      campaignText: "",
      productIds: ["pizza"],
      assetIds: ["photo", "logo"],
    },
    [
      binding("pizza", "name"),
      binding("pizza", "price"),
      {
        id: "venue",
        sourceType: "VENUE",
        sourceId: "venue",
        field: "name",
        value: "Synthetic Pizza Fixture",
        version: "v1",
      },
      {
        id: "address",
        sourceType: "BRAND",
        sourceId: "brand",
        field: "address",
        value: "Sample Street 1, Sample City",
        version: "v1",
      },
      {
        id: "directions_qr",
        sourceType: "QR",
        sourceId: "brand",
        field: "destination",
        value: "https://maps.example/fixture",
        version: "v1",
      },
    ],
    [
      { id: "photo", kind: "PRODUCT" },
      { id: "logo", kind: "LOGO" },
    ],
  );
  const layers = doc.pages[0]!.layers;
  expect(layers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "image",
        assetId: "photo",
        radius: 28,
      }),
      expect.objectContaining({
        id: "feature_card",
        type: "shape",
        radius: 30,
      }),
      expect.objectContaining({
        id: "product_0",
        type: "product",
        fontSize: 44,
        bindingId: "pizza_name",
      }),
      expect.objectContaining({
        id: "price_0",
        type: "price",
        fontSize: 38,
        bindingId: "pizza_price",
      }),
      expect.objectContaining({ id: "qr", type: "qr" }),
    ]),
  );
  expect(
    layers.filter(
      (layer) => layer.type === "product" && layer.bindingId === "pizza_name",
    ),
  ).toHaveLength(1);
  expect(doc.pages[0]!.background).toBe("#f8f3e9");
});
it("distinguishes current exports, changed working copies and archived work", () => {
  expect(creativeArchiveState("DRAFT", 1)).toBe("DRAFT");
  expect(creativeArchiveState("DRAFT", 3, 3)).toBe("CURRENT");
  expect(creativeArchiveState("DRAFT", 4, 3)).toBe("CHANGED");
  expect(creativeArchiveState("ARCHIVED", 4, 3)).toBe("ARCHIVED");
});
