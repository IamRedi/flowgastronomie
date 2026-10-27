import { describe, it, expect } from "vitest";
import { reconcilePreviewCart } from "./public-preview-cart";
import type { Website } from "../app/[lang]/order/[publicSlug]/online-order-menu-client";
const menu: Website = {
  venue: { name: "Test", currency: "EUR" },
  menu: [
    {
      id: "c",
      name: "Menu",
      products: [
        {
          id: "p",
          name: "Dish",
          description: null,
          priceMinor: 800,
          available: true,
          variants: [
            {
              id: "v",
              name: "Large",
              priceDeltaMinor: 200,
              isDefault: true,
              available: true,
            },
          ],
          modifierGroups: [
            {
              id: "g",
              name: "Extra",
              minSelect: 1,
              maxSelect: 1,
              options: [
                {
                  id: "o",
                  name: "Basil",
                  priceDeltaMinor: 100,
                  available: true,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
const saved = {
  productId: "p",
  variantId: "v",
  optionIds: ["o"],
  quantity: 2,
  notes: "No salt",
  priceMinor: 1100,
};
describe("canonical public basket recovery", () => {
  it("keeps independently edited lines addressable after refresh", () => {
    const result = reconcilePreviewCart(
      [saved, { ...saved, quantity: 1 }],
      menu,
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.key).not.toBe(result.items[1]!.key);
    expect(result.items.map((item) => item.quantity)).toEqual([2, 1]);
  });
  it("restores identifiers/options and detects approved price changes", () => {
    const result = reconcilePreviewCart([saved], menu);
    expect(result.changed).toBe(false);
    expect(result.items[0]).toMatchObject({
      quantity: 2,
      notes: "No salt",
      variant: { id: "v" },
    });
    expect(
      reconcilePreviewCart([{ ...saved, priceMinor: 1000 }], menu).changed,
    ).toBe(true);
  });
  it("rejects foreign, unavailable and newly invalid required selections", () => {
    for (const invalid of [
      { ...saved, productId: "other-tenant" },
      { ...saved, optionIds: [] },
      { ...saved, quantity: 21 },
      { ...saved, optionIds: ["o", "o"] },
    ])
      expect(reconcilePreviewCart([invalid], menu)).toEqual({
        items: [],
        changed: true,
      });
    const hidden = structuredClone(menu);
    hidden.menu[0]!.products[0]!.available = false;
    expect(reconcilePreviewCart([saved], hidden).items).toEqual([]);
  });
});
