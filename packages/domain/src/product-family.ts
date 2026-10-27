export const PRODUCT_CODES = [
  "RESTAURANT",
  "PIZZERIA",
  "BAR",
  "CAFE",
  "IMBISS",
  "DELIVERY",
] as const;

export type ProductCode = (typeof PRODUCT_CODES)[number];

export const PRODUCT_STATUSES = ["ACTIVE", "PLANNED", "LATER"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export type ProductDefinition = {
  code: ProductCode;
  name: `${string}Flow`;
  status: ProductStatus;
};

export const PRODUCT_CATALOG: readonly ProductDefinition[] = [
  { code: "RESTAURANT", name: "RestaurantFlow", status: "ACTIVE" },
  { code: "PIZZERIA", name: "PizzeriaFlow", status: "PLANNED" },
  { code: "BAR", name: "BarFlow", status: "PLANNED" },
  { code: "CAFE", name: "CaféFlow", status: "PLANNED" },
  { code: "IMBISS", name: "ImbissFlow", status: "PLANNED" },
  { code: "DELIVERY", name: "DeliveryFlow", status: "LATER" },
] as const;

export function isProductSelectableInOnboarding(code: ProductCode): boolean {
  return PRODUCT_CATALOG.some(
    (product) => product.code === code && product.status === "ACTIVE",
  );
}
