import { describe, expect, it } from "vitest";

import {
  convertIngredientQuantity,
  IncompatibleIngredientUnitsError,
  InvalidIngredientQuantityError,
  isValidIngredientBaseUnit,
} from "../src/index.js";

describe("ingredient units", () => {
  it("converts explicit mass and volume units", () => {
    expect(convertIngredientQuantity(2, "KILOGRAM", "GRAM")).toBe(2_000);
    expect(convertIngredientQuantity(3, "LITER", "MILLILITER")).toBe(3_000);
  });

  it("rejects incompatible or lossy unit conversions", () => {
    expect(() => convertIngredientQuantity(1, "GRAM", "MILLILITER")).toThrow(
      IncompatibleIngredientUnitsError,
    );
    expect(() => convertIngredientQuantity(1, "GRAM", "KILOGRAM")).toThrow(
      InvalidIngredientQuantityError,
    );
  });

  it("allows only canonical base units for ingredient stock", () => {
    expect(isValidIngredientBaseUnit("GRAM")).toBe(true);
    expect(isValidIngredientBaseUnit("MILLILITER")).toBe(true);
    expect(isValidIngredientBaseUnit("PIECE")).toBe(true);
    expect(isValidIngredientBaseUnit("KILOGRAM")).toBe(false);
  });
});
