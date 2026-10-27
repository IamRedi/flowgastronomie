import type {
  CartItem,
  Website,
} from "../app/[lang]/order/[publicSlug]/online-order-menu-client";
export type SavedSelection = {
  productId: string;
  variantId?: string | undefined;
  optionIds: string[];
  quantity: number;
  notes: string;
};
export function reconcilePreviewCart(
  saved: unknown,
  website: Website,
): { items: CartItem[]; changed: boolean } {
  if (!Array.isArray(saved)) return { items: [], changed: true };
  const products = website.menu.flatMap((category) => category.products);
  const items: CartItem[] = [];
  let changed = false;
  for (const entry of saved.slice(0, 30)) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !Number.isInteger(entry.quantity) ||
      entry.quantity < 1 ||
      entry.quantity > 20 ||
      !Array.isArray(entry.optionIds) ||
      entry.optionIds.some((id: unknown) => typeof id !== "string")
    )
      continue;
    const product = products.find(
      (product) => product.id === entry.productId && product.available,
    );
    if (!product) continue;
    const variant =
      product.variants.find(
        (variant) => variant.id === entry.variantId && variant.available,
      ) ?? null;
    if (product.variants.length && !variant) continue;
    const modifiers = product.modifierGroups.flatMap((group) =>
      group.options
        .filter(
          (option) => option.available && entry.optionIds.includes(option.id),
        )
        .map((option) => ({ group, option })),
    );
    if (modifiers.length !== entry.optionIds.length) continue;
    if (
      product.modifierGroups.some((group) => {
        const count = modifiers.filter((m) => m.group.id === group.id).length;
        return count < group.minSelect || count > group.maxSelect;
      })
    )
      continue;
    const price =
      product.priceMinor +
      (variant?.priceDeltaMinor ?? 0) +
      modifiers.reduce((n, m) => n + m.option.priceDeltaMinor, 0);
    if (typeof entry.priceMinor === "number" && entry.priceMinor !== price)
      changed = true;
    const notes =
      typeof entry.notes === "string" ? entry.notes.slice(0, 200).trim() : "";
    const key = [
      product.id,
      variant?.id ?? "default",
      ...modifiers.map((item) => item.option.id).sort(),
      notes,
      String(items.length),
    ].join(":");
    items.push({
      key,
      product,
      variant,
      modifiers,
      quantity: entry.quantity,
      notes,
    });
  }
  return { items, changed: changed || items.length !== saved.length };
}
export function restorePreviewCart(key: string, website: Website) {
  try {
    const saved = sessionStorage.getItem(key);
    return saved
      ? reconcilePreviewCart(JSON.parse(saved), website)
      : { items: [], changed: false };
  } catch {
    return { items: [], changed: false };
  }
}
export function savePreviewCart(key: string, items: CartItem[]) {
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify(
        items.map((item) => ({
          productId: item.product.id,
          variantId: item.variant?.id,
          optionIds: item.modifiers.map((entry) => entry.option.id),
          quantity: item.quantity,
          notes: item.notes ?? "",
        })),
      ),
    );
  } catch {
    /* The live basket still works when storage is unavailable. */
  }
}
