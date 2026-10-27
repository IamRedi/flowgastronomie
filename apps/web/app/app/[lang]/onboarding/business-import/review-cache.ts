import {
  businessReviewSchema,
  type BusinessReview,
} from "@flowgastronomie/domain";
const key = (id: string) => `flowgastronomie.import-review.${id}`;
export function cacheReview(id: string, review: BusinessReview) {
  try {
    sessionStorage.setItem(
      key(id),
      JSON.stringify({ ...review, confirm: false }),
    );
  } catch {
    /* The visible unsaved state still protects against silently claiming persistence. */
  }
}
export function cachedReview(id: string): BusinessReview | null {
  try {
    const result = businessReviewSchema.safeParse(
      JSON.parse(sessionStorage.getItem(key(id)) ?? "null"),
    );
    return result.success ? { ...result.data, confirm: false } : null;
  } catch {
    return null;
  }
}
export function clearReviewCache(id: string) {
  try {
    sessionStorage.removeItem(key(id));
  } catch {
    /* Browser storage can be unavailable. */
  }
}
export function sameReview(a: BusinessReview, b: BusinessReview) {
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, stable(v)]),
          )
        : value;
  return (
    JSON.stringify(stable({ ...a, confirm: false, expectedVersion: 0 })) ===
    JSON.stringify(stable({ ...b, confirm: false, expectedVersion: 0 }))
  );
}
