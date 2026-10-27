import { describe, expect, it } from "vitest";

import {
  calculateDailyRecipeCost,
  calculateRecipeCost,
  InvalidRecipeCostInputError,
} from "../src/index.js";

describe("recipe cost", () => {
  it("aggregates snapshot selling prices with complete current recipe estimates", () => {
    expect(
      calculateDailyRecipeCost([
        {
          productId: "dish",
          quantity: 2,
          sellingPriceMinor: 1_200,
          estimate: {
            complete: true,
            missingPriceIngredientIds: [],
            directCostMinor: 250,
            foodCostBasisPoints: 2_083,
            grossContributionMinor: 950,
          },
        },
      ]),
    ).toEqual({
      complete: true,
      itemCount: 2,
      costedItemCount: 2,
      estimatedOrderValueMinor: 2_400,
      estimatedDirectCostMinor: 500,
      estimatedFoodCostBasisPoints: 2_083,
      estimatedContributionMinor: 1_900,
      missingRecipeProductIds: [],
      missingPriceIngredientIds: [],
    });
  });

  it("withholds an aggregate estimate when recipe or active-price coverage is incomplete", () => {
    expect(
      calculateDailyRecipeCost([
        {
          productId: "no-recipe",
          quantity: 1,
          sellingPriceMinor: 500,
          estimate: null,
        },
        {
          productId: "no-price",
          quantity: 1,
          sellingPriceMinor: 700,
          estimate: {
            complete: false,
            missingPriceIngredientIds: ["tomato"],
            directCostMinor: null,
            foodCostBasisPoints: null,
            grossContributionMinor: null,
          },
        },
      ]),
    ).toMatchObject({
      complete: false,
      itemCount: 2,
      costedItemCount: 0,
      estimatedOrderValueMinor: 1_200,
      estimatedDirectCostMinor: null,
      estimatedContributionMinor: null,
      missingRecipeProductIds: ["no-recipe"],
      missingPriceIngredientIds: ["tomato"],
    });
  });

  it("calculates a conservative direct cost, food cost, and contribution", () => {
    expect(
      calculateRecipeCost({
        sellingPriceMinor: 1_200,
        yieldBasisPoints: 9_000,
        wastageBasisPoints: 500,
        components: [
          {
            ingredientId: "flour",
            quantityBaseUnits: 200,
            price: { packBaseQuantity: 1_000, priceMinor: 399 },
          },
        ],
      }),
    ).toEqual({
      complete: true,
      missingPriceIngredientIds: [],
      directCostMinor: 94,
      foodCostBasisPoints: 783,
      grossContributionMinor: 1_106,
    });
  });

  it("does not invent an estimate when a recipe ingredient has no price", () => {
    expect(
      calculateRecipeCost({
        sellingPriceMinor: 1_200,
        yieldBasisPoints: 10_000,
        wastageBasisPoints: 0,
        components: [
          { ingredientId: "flour", quantityBaseUnits: 100, price: null },
        ],
      }),
    ).toMatchObject({ complete: false, missingPriceIngredientIds: ["flour"] });
  });

  it("rejects zero yield and invalid quantities", () => {
    expect(() =>
      calculateRecipeCost({
        sellingPriceMinor: 100,
        yieldBasisPoints: 0,
        wastageBasisPoints: 0,
        components: [],
      }),
    ).toThrow(InvalidRecipeCostInputError);
  });
});
