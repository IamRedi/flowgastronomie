import type {
  AllergenCode,
  IngredientBaseUnit,
  IngredientQuantityUnit,
} from "@prisma/client";
import {
  assertStaffPermission,
  convertIngredientQuantity,
  calculateRecipeCost,
  type IngredientUnit,
  type StaffRole,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import { subscriptionRepository } from "./subscription-repository.js";

type StaffScope = {
  tenantId: string;
  venueId: string;
  role: StaffRole;
};

export type CostIngredient = {
  id: string;
  name: string;
  baseUnit: IngredientBaseUnit;
  allergens: AllergenCode[];
  active: boolean;
};

export type CostSupplier = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
};

export type SupplierItemPrice = {
  id: string;
  supplierId: string;
  ingredientId: string;
  packQuantity: number;
  unit: IngredientQuantityUnit;
  priceMinor: number;
  currency: string;
  effectiveFrom: Date;
  createdAt: Date;
};

export type StaffCostCatalog = {
  venue: { id: string; currency: string };
  ingredients: CostIngredient[];
  suppliers: CostSupplier[];
  prices: SupplierItemPrice[];
};

export type StaffCostRepository = {
  list(staff: StaffScope): Promise<StaffCostCatalog>;
  createIngredient(input: {
    staff: StaffScope;
    name: string;
    baseUnit: IngredientBaseUnit;
    allergens: AllergenCode[];
    active: boolean;
  }): Promise<CostIngredient>;
  updateIngredient(input: {
    staff: StaffScope;
    ingredientId: string;
    name: string;
    allergens: AllergenCode[];
    active: boolean;
  }): Promise<CostIngredient>;
  createSupplier(input: {
    staff: StaffScope;
    name: string;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    active: boolean;
  }): Promise<CostSupplier>;
  updateSupplier(input: {
    staff: StaffScope;
    supplierId: string;
    name: string;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    active: boolean;
  }): Promise<CostSupplier>;
  addPrice(input: {
    staff: StaffScope;
    supplierId: string;
    ingredientId: string;
    packQuantity: number;
    unit: IngredientQuantityUnit;
    priceMinor: number;
    effectiveFrom: Date;
  }): Promise<SupplierItemPrice>;
  getRecipe(input: { staff: StaffScope; productId: string }): Promise<unknown>;
  replaceRecipe(input: {
    staff: StaffScope;
    productId: string;
    yieldBasisPoints: number;
    wastageBasisPoints: number;
    ingredients: Array<{ ingredientId: string; quantityBaseUnits: number }>;
  }): Promise<unknown>;
};

export class StaffCostResourceNotFoundError extends Error {
  constructor(resource: "venue" | "ingredient" | "supplier" | "product") {
    super(`The ${resource} was not found in this venue`);
    this.name = "StaffCostResourceNotFoundError";
  }
}

export class StaffCostConflictError extends Error {
  constructor(resource: "ingredient" | "supplier") {
    super(`An ${resource} with this name already exists in this venue`);
    this.name = "StaffCostConflictError";
  }
}

function costPermission(staff: StaffScope) {
  assertStaffPermission(staff.role, "COST_MANAGE");
}
async function assertCostFeature(staff: StaffScope) {
  await subscriptionRepository.assertFeature(staff.tenantId, "RECIPE_COSTING");
}

function mapIngredient(ingredient: {
  id: string;
  name: string;
  baseUnit: IngredientBaseUnit;
  allergens: AllergenCode[];
  active: boolean;
}): CostIngredient {
  return ingredient;
}

function mapSupplier(supplier: CostSupplier): CostSupplier {
  return supplier;
}

function mapPrice(price: SupplierItemPrice): SupplierItemPrice {
  return price;
}

async function assertIngredient(ingredientId: string, staff: StaffScope) {
  const ingredient = await prisma.ingredient.findFirst({
    where: {
      id: ingredientId,
      tenantId: staff.tenantId,
      venueId: staff.venueId,
    },
  });
  if (!ingredient) throw new StaffCostResourceNotFoundError("ingredient");
  return ingredient;
}

async function assertSupplier(supplierId: string, staff: StaffScope) {
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, tenantId: staff.tenantId, venueId: staff.venueId },
  });
  if (!supplier) throw new StaffCostResourceNotFoundError("supplier");
  return supplier;
}

async function recipeSummary(staff: StaffScope, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId: staff.tenantId, venueId: staff.venueId },
    include: {
      recipe: { include: { ingredients: { include: { ingredient: true } } } },
    },
  });
  if (!product) throw new StaffCostResourceNotFoundError("product");
  if (!product.recipe) return { productId, recipe: null, estimate: null };
  const prices = await prisma.supplierItemPrice.findMany({
    where: {
      tenantId: staff.tenantId,
      venueId: staff.venueId,
      effectiveFrom: { lte: new Date() },
      supplier: { active: true },
    },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  const priceByIngredient = new Map<string, (typeof prices)[number]>();
  for (const price of prices)
    if (!priceByIngredient.has(price.ingredientId))
      priceByIngredient.set(price.ingredientId, price);
  return {
    productId,
    recipe: {
      yieldBasisPoints: product.recipe.yieldBasisPoints,
      wastageBasisPoints: product.recipe.wastageBasisPoints,
      ingredients: product.recipe.ingredients.map((item) => ({
        ingredientId: item.ingredientId,
        quantityBaseUnits: item.quantityBaseUnits,
      })),
    },
    estimate: calculateRecipeCost({
      sellingPriceMinor: product.priceMinor,
      yieldBasisPoints: product.recipe.yieldBasisPoints,
      wastageBasisPoints: product.recipe.wastageBasisPoints,
      components: product.recipe.ingredients.map((item) => {
        const price = priceByIngredient.get(item.ingredientId);
        return {
          ingredientId: item.ingredientId,
          quantityBaseUnits: item.quantityBaseUnits,
          price: price
            ? {
                packBaseQuantity: convertIngredientQuantity(
                  price.packQuantity,
                  price.unit as IngredientUnit,
                  item.ingredient.baseUnit as IngredientUnit,
                ),
                priceMinor: price.priceMinor,
              }
            : null,
        };
      }),
    }),
  };
}

async function assertUniqueName(input: {
  kind: "ingredient" | "supplier";
  name: string;
  staff: StaffScope;
  excludingId?: string;
}) {
  const where = {
    name: input.name,
    tenantId: input.staff.tenantId,
    venueId: input.staff.venueId,
    ...(input.excludingId ? { id: { not: input.excludingId } } : {}),
  };
  const existing =
    input.kind === "ingredient"
      ? await prisma.ingredient.findFirst({ where, select: { id: true } })
      : await prisma.supplier.findFirst({ where, select: { id: true } });
  if (existing) throw new StaffCostConflictError(input.kind);
}

export const staffCostRepository: StaffCostRepository = {
  async list(staff) {
    await assertCostFeature(staff);
    costPermission(staff);
    const venue = await prisma.venue.findFirst({
      where: { id: staff.venueId, tenantId: staff.tenantId },
      select: { id: true, currency: true },
    });
    if (!venue) throw new StaffCostResourceNotFoundError("venue");
    const scope = { tenantId: staff.tenantId, venueId: staff.venueId };
    const [ingredients, suppliers, prices] = await Promise.all([
      prisma.ingredient.findMany({ where: scope, orderBy: { name: "asc" } }),
      prisma.supplier.findMany({ where: scope, orderBy: { name: "asc" } }),
      prisma.supplierItemPrice.findMany({
        where: scope,
        orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      }),
    ]);
    return {
      venue,
      ingredients: ingredients.map(mapIngredient),
      suppliers: suppliers.map(mapSupplier),
      prices: prices.map(mapPrice),
    };
  },

  async createIngredient({ staff, ...input }) {
    await assertCostFeature(staff);
    costPermission(staff);
    await assertUniqueName({ kind: "ingredient", name: input.name, staff });
    return mapIngredient(
      await prisma.ingredient.create({
        data: { ...input, tenantId: staff.tenantId, venueId: staff.venueId },
      }),
    );
  },

  async updateIngredient({ staff, ingredientId, ...input }) {
    await assertCostFeature(staff);
    costPermission(staff);
    await assertIngredient(ingredientId, staff);
    await assertUniqueName({
      kind: "ingredient",
      name: input.name,
      staff,
      excludingId: ingredientId,
    });
    return mapIngredient(
      await prisma.ingredient.update({
        where: { id: ingredientId },
        data: input,
      }),
    );
  },

  async createSupplier({ staff, ...input }) {
    await assertCostFeature(staff);
    costPermission(staff);
    await assertUniqueName({ kind: "supplier", name: input.name, staff });
    return mapSupplier(
      await prisma.supplier.create({
        data: { ...input, tenantId: staff.tenantId, venueId: staff.venueId },
      }),
    );
  },

  async updateSupplier({ staff, supplierId, ...input }) {
    await assertCostFeature(staff);
    costPermission(staff);
    await assertSupplier(supplierId, staff);
    await assertUniqueName({
      kind: "supplier",
      name: input.name,
      staff,
      excludingId: supplierId,
    });
    return mapSupplier(
      await prisma.supplier.update({ where: { id: supplierId }, data: input }),
    );
  },

  async addPrice({
    staff,
    supplierId,
    ingredientId,
    unit,
    packQuantity,
    ...input
  }) {
    await assertCostFeature(staff);
    costPermission(staff);
    const [supplier, ingredient, venue] = await Promise.all([
      assertSupplier(supplierId, staff),
      assertIngredient(ingredientId, staff),
      prisma.venue.findFirst({
        where: { id: staff.venueId, tenantId: staff.tenantId },
        select: { currency: true },
      }),
    ]);
    if (!venue) throw new StaffCostResourceNotFoundError("venue");
    convertIngredientQuantity(
      packQuantity,
      unit as IngredientUnit,
      ingredient.baseUnit as IngredientUnit,
    );
    return mapPrice(
      await prisma.supplierItemPrice.create({
        data: {
          ...input,
          supplierId: supplier.id,
          ingredientId: ingredient.id,
          packQuantity,
          unit,
          currency: venue.currency,
          tenantId: staff.tenantId,
          venueId: staff.venueId,
        },
      }),
    );
  },

  async getRecipe({ staff, productId }) {
    await assertCostFeature(staff);
    costPermission(staff);
    return recipeSummary(staff, productId);
  },

  async replaceRecipe({
    staff,
    productId,
    yieldBasisPoints,
    wastageBasisPoints,
    ingredients,
  }) {
    await assertCostFeature(staff);
    costPermission(staff);
    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        tenantId: staff.tenantId,
        venueId: staff.venueId,
      },
      select: { id: true },
    });
    if (!product) throw new StaffCostResourceNotFoundError("product");
    for (const item of ingredients)
      await assertIngredient(item.ingredientId, staff);
    await prisma.$transaction(async (tx) => {
      const recipe = await tx.recipe.upsert({
        where: { productId },
        create: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          productId,
          yieldBasisPoints,
          wastageBasisPoints,
        },
        update: { yieldBasisPoints, wastageBasisPoints },
      });
      await tx.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });
      await tx.recipeIngredient.createMany({
        data: ingredients.map((item) => ({
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          recipeId: recipe.id,
          ...item,
        })),
      });
    });
    return recipeSummary(staff, productId);
  },
};
