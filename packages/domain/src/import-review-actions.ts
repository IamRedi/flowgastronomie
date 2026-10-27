import { SetupImportError } from "./smart-setup";
import { validateReviewedMenuItem } from "./menu-import";
import type { BusinessReview } from "./business-import";
/** Only an explicit group acknowledgement approves prices/configuration/duplicate handling. */
export function approveSelectedImportItems(
  review: BusinessReview,
  ids: string[],
  currency: string,
  acknowledged: boolean,
) {
  if (
    !acknowledged ||
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !review.items.some((i) => i.id === id))
  )
    throw new SetupImportError("REVIEW_REQUIRED");
  const blocked: string[] = [];
  const items = review.items.map((row) => {
    if (!ids.includes(row.id)) return row;
    const item = { ...row.item, duplicateAcknowledged: true };
    try {
      validateReviewedMenuItem(item, currency, []);
    } catch {
      blocked.push(row.id);
      return row;
    }
    return {
      ...row,
      item,
      action: row.action === "UPDATE" ? ("UPDATE" as const) : ("ADD" as const),
      targetProductId: row.action === "UPDATE" ? row.targetProductId : null,
      approvePrice: true,
      approveConfiguration: true,
    };
  });
  return { review: { ...review, items, confirm: false }, blocked };
}
