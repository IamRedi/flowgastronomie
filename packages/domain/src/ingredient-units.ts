export const INGREDIENT_UNITS = [
  "GRAM",
  "KILOGRAM",
  "MILLILITER",
  "LITER",
  "PIECE",
] as const;

export type IngredientUnit = (typeof INGREDIENT_UNITS)[number];
export type IngredientUnitDimension = "MASS" | "VOLUME" | "COUNT";

const unitDefinition: Record<
  IngredientUnit,
  { dimension: IngredientUnitDimension; baseFactor: number }
> = {
  GRAM: { dimension: "MASS", baseFactor: 1 },
  KILOGRAM: { dimension: "MASS", baseFactor: 1_000 },
  MILLILITER: { dimension: "VOLUME", baseFactor: 1 },
  LITER: { dimension: "VOLUME", baseFactor: 1_000 },
  PIECE: { dimension: "COUNT", baseFactor: 1 },
};

export function ingredientUnitDimension(unit: IngredientUnit) {
  return unitDefinition[unit].dimension;
}

export function isValidIngredientBaseUnit(unit: IngredientUnit) {
  return unit === "GRAM" || unit === "MILLILITER" || unit === "PIECE";
}

export class IncompatibleIngredientUnitsError extends Error {
  constructor(from: IngredientUnit, to: IngredientUnit) {
    super(`Cannot convert ${from} to ${to}`);
    this.name = "IncompatibleIngredientUnitsError";
  }
}

export class InvalidIngredientQuantityError extends Error {
  constructor() {
    super("Ingredient quantity must be a non-negative safe integer");
    this.name = "InvalidIngredientQuantityError";
  }
}

export function convertIngredientQuantity(
  quantity: number,
  from: IngredientUnit,
  to: IngredientUnit,
) {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new InvalidIngredientQuantityError();
  }
  const fromDefinition = unitDefinition[from];
  const toDefinition = unitDefinition[to];
  if (fromDefinition.dimension !== toDefinition.dimension) {
    throw new IncompatibleIngredientUnitsError(from, to);
  }
  const baseQuantity = quantity * fromDefinition.baseFactor;
  if (
    !Number.isSafeInteger(baseQuantity) ||
    baseQuantity % toDefinition.baseFactor
  ) {
    throw new InvalidIngredientQuantityError();
  }
  return baseQuantity / toDefinition.baseFactor;
}
