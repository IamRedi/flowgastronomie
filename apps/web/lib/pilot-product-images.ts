export type ProductImage = {
  src: string;
  kind: "approved" | "demo";
  label?: string | undefined;
};
type ImageScope = {
  tenantId: string;
  venueId: string;
  productId: string;
  demo: boolean;
};

// Approved local WebP/AVIF assets belong to an exact tenant/venue/product key.
// Legacy CI compatibility only. Real tenants use canonical ProductMedia from API.
export const approvedProductImages: Readonly<Record<string, string>> = {};

// Illustrations only for the explicitly enabled local demo. No name matching:
// an unrelated venue/product must never acquire somebody else's photography.
const demoImages: Readonly<Record<string, string>> = {
  "pilot-product-pizza-1": "margherita",
  "pilot-product-pizza-2": "salami",
  "pilot-product-pizza-3": "salami",
  "pilot-product-pizza-4": "prosciutto",
  "pilot-product-pizza-5": "funghi",
  "pilot-product-pizza-10": "vegetariana",
  "pilot-product-pizza-14": "funghi",
  "pilot-product-drinks-1": "drink",
  "pilot-product-drinks-2": "drink",
  "pilot-product-dessert-1": "dessert",
  "pilot-product-salads-1": "salad",
};

export function resolveProductImage(
  scope: ImageScope,
  approved = approvedProductImages,
): ProductImage | undefined {
  const real =
    approved[`${scope.tenantId}/${scope.venueId}/${scope.productId}`];
  if (real) return { src: real, kind: "approved" };
  if (
    !scope.demo ||
    scope.tenantId !== "demo-tenant" ||
    scope.venueId !== "demo-venue"
  )
    return undefined;
  const image = demoImages[scope.productId];
  return image
    ? { src: `/pilot/demo-food/${image}.webp`, kind: "demo" }
    : undefined;
}
