export type RecentOrder = { referenceCode: string; destination: string };
const key = (slug: string) => `recent-online-order:v1:${slug}`;
function valid(value: unknown): value is RecentOrder {
  if (!value || typeof value !== "object") return false;
  const item = value as RecentOrder;
  if (typeof item.destination !== "string") return false;
  try {
    const url = new URL(item.destination, "http://session.local");
    if ([...url.searchParams.keys()].some((key) => key !== "venue"))
      return false;
  } catch {
    return false;
  }
  return (
    typeof item.referenceCode === "string" &&
    /^RF-[A-Z0-9]{6,20}$/.test(item.referenceCode) &&
    typeof item.destination === "string" &&
    /^\/(sq|de|it|en)\/order\/track\/([\w-]{16,128}|recovered)(\?[^#]*)?$/.test(
      item.destination,
    )
  );
}
// Convenience only. Authorization still requires the opaque token or recovery
// cookie. No contact details, phone numbers or order contents are stored here.
export function rememberRecentOrder(slug: string, order: RecentOrder) {
  if (valid(order)) {
    try {
      sessionStorage.setItem(key(slug), JSON.stringify(order));
    } catch {}
  }
}
export function recentOrder(slug: string) {
  try {
    const parsed: unknown = JSON.parse(
      sessionStorage.getItem(key(slug)) ?? "null",
    );
    return valid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
