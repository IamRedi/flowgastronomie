// Browser drafts are presentation state. The API resolves availability, prices,
// permissions and idempotency; this cache never authorizes an order.
export type PosCartLine = {
  key: string;
  productId: string;
  productName: string;
  unitPriceMinor: number;
  quantity: number;
  variantId?: string | undefined;
  variantName: string | null;
  modifierOptionIds: string[];
  modifiersLabel: string;
  notes: string;
};
export type PosRecovery = {
  version: 1;
  savedAt: number;
  key: string;
  locale: string;
  orderType: "DINE_IN" | "TAKEAWAY";
  tableId: string;
  pending: boolean;
  cart: PosCartLine[];
};
export function posRecoveryKey(scope: {
  tenantId: string;
  venueId: string;
  email: string;
}) {
  return `pos-draft:v1:${JSON.stringify([scope.tenantId, scope.venueId, scope.email])}`;
}
const text = (v: unknown, max = 500): v is string =>
  typeof v === "string" && v.length <= max;
export function readPosRecovery(
  raw: string | null,
  now = Date.now(),
): PosRecovery | null {
  if (!raw || raw.length > 100_000) return null;
  try {
    const d = JSON.parse(raw) as PosRecovery;
    if (
      d.version !== 1 ||
      !Number.isFinite(d.savedAt) ||
      d.savedAt > now ||
      !text(d.key, 100) ||
      !/^[a-f0-9-]{36}$/i.test(d.key) ||
      !["en", "de", "sq", "it"].includes(d.locale) ||
      !["DINE_IN", "TAKEAWAY"].includes(d.orderType) ||
      !text(d.tableId, 100) ||
      typeof d.pending !== "boolean" ||
      !Array.isArray(d.cart) ||
      d.cart.length > 100 ||
      (!d.pending && now - d.savedAt > 12 * 60 * 60 * 1000)
    )
      return null;
    if (
      !d.cart.every(
        (l) =>
          l &&
          text(l.key, 100) &&
          text(l.productId, 100) &&
          text(l.productName) &&
          Number.isSafeInteger(l.unitPriceMinor) &&
          l.unitPriceMinor >= 0 &&
          Number.isSafeInteger(l.quantity) &&
          l.quantity > 0 &&
          l.quantity <= 100 &&
          (l.variantId === undefined || text(l.variantId, 100)) &&
          (l.variantName === null || text(l.variantName)) &&
          text(l.modifiersLabel, 5000) &&
          text(l.notes, 200) &&
          Array.isArray(l.modifierOptionIds) &&
          l.modifierOptionIds.length <= 100 &&
          l.modifierOptionIds.every((id) => text(id, 100)),
      )
    )
      return null;
    return d;
  } catch {
    return null;
  }
}
