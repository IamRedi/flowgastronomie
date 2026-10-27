export type RecipeCostComponent = {
  ingredientId: string;
  quantityBaseUnits: number;
  price: { packBaseQuantity: number; priceMinor: number } | null;
};

export type RecipeCostInput = {
  sellingPriceMinor: number;
  yieldBasisPoints: number;
  wastageBasisPoints: number;
  components: RecipeCostComponent[];
};

export type RecipeCostEstimate = {
  complete: boolean;
  missingPriceIngredientIds: string[];
  directCostMinor: number | null;
  foodCostBasisPoints: number | null;
  grossContributionMinor: number | null;
};

export type DailyRecipeCostItem = {
  productId: string;
  quantity: number;
  sellingPriceMinor: number;
  estimate: RecipeCostEstimate | null;
};

export type DailyRecipeCostProjection = {
  complete: boolean;
  itemCount: number;
  costedItemCount: number;
  estimatedOrderValueMinor: number;
  estimatedDirectCostMinor: number | null;
  estimatedFoodCostBasisPoints: number | null;
  estimatedContributionMinor: number | null;
  missingRecipeProductIds: string[];
  missingPriceIngredientIds: string[];
};

export class InvalidRecipeCostInputError extends Error {
  constructor() {
    super(
      "Recipe quantities, price, yield, and wastage must use safe valid values",
    );
    this.name = "InvalidRecipeCostInputError";
  }
}

function validInteger(value: number, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function ceilDivide(numerator: bigint, denominator: bigint) {
  return (numerator + denominator - 1n) / denominator;
}

export function calculateRecipeCost(
  input: RecipeCostInput,
): RecipeCostEstimate {
  if (
    !validInteger(input.sellingPriceMinor) ||
    !validInteger(input.yieldBasisPoints, 1) ||
    input.yieldBasisPoints > 10_000 ||
    !validInteger(input.wastageBasisPoints) ||
    input.wastageBasisPoints > 10_000
  ) {
    throw new InvalidRecipeCostInputError();
  }

  const missingPriceIngredientIds: string[] = [];
  let total = 0n;
  for (const component of input.components) {
    if (!validInteger(component.quantityBaseUnits, 1)) {
      throw new InvalidRecipeCostInputError();
    }
    if (!component.price) {
      missingPriceIngredientIds.push(component.ingredientId);
      continue;
    }
    if (
      !validInteger(component.price.packBaseQuantity, 1) ||
      !validInteger(component.price.priceMinor)
    ) {
      throw new InvalidRecipeCostInputError();
    }
    total += ceilDivide(
      BigInt(component.price.priceMinor) *
        BigInt(component.quantityBaseUnits) *
        BigInt(10_000 + input.wastageBasisPoints),
      BigInt(component.price.packBaseQuantity) * BigInt(input.yieldBasisPoints),
    );
  }
  if (missingPriceIngredientIds.length) {
    return {
      complete: false,
      missingPriceIngredientIds,
      directCostMinor: null,
      foodCostBasisPoints: null,
      grossContributionMinor: null,
    };
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InvalidRecipeCostInputError();
  }
  const directCostMinor = Number(total);
  return {
    complete: true,
    missingPriceIngredientIds: [],
    directCostMinor,
    foodCostBasisPoints:
      input.sellingPriceMinor === 0
        ? null
        : Number(
            (BigInt(directCostMinor) * 10_000n) /
              BigInt(input.sellingPriceMinor),
          ),
    grossContributionMinor: input.sellingPriceMinor - directCostMinor,
  };
}

/** Aggregates immutable sold-item prices against today's recipe-cost estimates. */
export function calculateDailyRecipeCost(
  items: DailyRecipeCostItem[],
): DailyRecipeCostProjection {
  let itemCount = 0;
  let costedItemCount = 0;
  let estimatedOrderValueMinor = 0;
  let estimatedDirectCostMinor = 0;
  const missingRecipeProductIds = new Set<string>();
  const missingPriceIngredientIds = new Set<string>();

  for (const item of items) {
    if (
      !validInteger(item.quantity, 1) ||
      !validInteger(item.sellingPriceMinor)
    ) {
      throw new InvalidRecipeCostInputError();
    }
    itemCount += item.quantity;
    estimatedOrderValueMinor += item.quantity * item.sellingPriceMinor;
    if (!item.estimate) {
      missingRecipeProductIds.add(item.productId);
      continue;
    }
    if (!item.estimate.complete || item.estimate.directCostMinor === null) {
      item.estimate.missingPriceIngredientIds.forEach((ingredientId) =>
        missingPriceIngredientIds.add(ingredientId),
      );
      continue;
    }
    costedItemCount += item.quantity;
    estimatedDirectCostMinor += item.quantity * item.estimate.directCostMinor;
  }

  if (
    !Number.isSafeInteger(estimatedOrderValueMinor) ||
    !Number.isSafeInteger(estimatedDirectCostMinor)
  ) {
    throw new InvalidRecipeCostInputError();
  }
  const complete =
    missingRecipeProductIds.size === 0 && missingPriceIngredientIds.size === 0;
  return {
    complete,
    itemCount,
    costedItemCount,
    estimatedOrderValueMinor,
    estimatedDirectCostMinor: complete ? estimatedDirectCostMinor : null,
    estimatedFoodCostBasisPoints:
      complete && estimatedOrderValueMinor > 0
        ? Number(
            (BigInt(estimatedDirectCostMinor) * 10_000n) /
              BigInt(estimatedOrderValueMinor),
          )
        : null,
    estimatedContributionMinor: complete
      ? estimatedOrderValueMinor - estimatedDirectCostMinor
      : null,
    missingRecipeProductIds: [...missingRecipeProductIds].sort(),
    missingPriceIngredientIds: [...missingPriceIngredientIds].sort(),
  };
}
