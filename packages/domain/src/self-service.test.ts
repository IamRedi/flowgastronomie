import { expect, it } from "vitest";
import {
  staffEntryPath,
  enabledInPos,
  assertPosActivation,
} from "./staff-entry";
import { approveSelectedImportItems } from "./import-review-actions";
import type { BusinessReview } from "./business-import";
const review = (): BusinessReview => ({
  expectedVersion: 0,
  canonicalRevision: "a".repeat(64),
  confirm: false,
  premiumStyleId: null,
  fields: [],
  media: [],
  items: [650, null].map((price, index) => ({
    id: `i${index}`,
    action: "PENDING",
    targetProductId: null,
    approvePrice: false,
    approveConfiguration: false,
    item: {
      name: "Soup",
      description: "",
      categoryName: "Lunch",
      categoryId: null,
      priceMinor: price,
      currency: "EUR",
      station: "KITCHEN",
      variants: [],
      modifierGroups: [],
      approvedAllergens: [],
      duplicateAcknowledged: false,
    },
  })),
});
it("returns requested authorized workspace only and blocks external/role escalation redirects", () => {
  expect(
    staffEntryPath("OWNER", "sq", "/app/sq/onboarding/business-import"),
  ).toBe("/app/sq/onboarding/business-import");
  expect(staffEntryPath("WAITER", "sq", "/app/sq/settings")).toBe(
    "/sq/staff/radar",
  );
  expect(staffEntryPath("MANAGER", "sq", "/app/sq/billing")).toBe(
    "/app/sq/overview",
  );
  expect(
    staffEntryPath(
      "OWNER",
      "sq",
      "/app/sq/onboarding/business-import?import=saved-id",
    ),
  ).toBe("/app/sq/onboarding/business-import?import=saved-id");
  expect(staffEntryPath("BAR", "de", "/de/staff/menu")).toBe("/de/staff/bar");
  for (const path of [
    "//evil.test",
    "/app/sq/../../evil",
    "/sq/staff/pos?next=x",
    "/app/sq/\\evil",
  ])
    expect(staffEntryPath("OWNER", "sq", path)).toBe("/app/sq/overview");
});
it("POS override is independent of public publication and preserves legacy choices", () => {
  expect(
    enabledInPos(
      { posEnabled: true, published: false, available: true },
      false,
    ),
  ).toBe(true);
  expect(
    enabledInPos({ posEnabled: false, published: true, available: true }, true),
  ).toBe(false);
  expect(enabledInPos({ published: true, available: true }, true)).toBe(true);
  expect(
    enabledInPos(
      { posEnabled: true, published: false, available: false },
      false,
    ),
  ).toBe(false);
});
it("POS activation requires a valid price and usable default variant", () => {
  expect(() =>
    assertPosActivation([
      { priceMinor: 650, variants: [{ available: true, isDefault: true }] },
    ]),
  ).not.toThrow();
  expect(() =>
    assertPosActivation([{ priceMinor: -1, variants: [] }]),
  ).toThrow();
  expect(() =>
    assertPosActivation([
      { priceMinor: 650, variants: [{ available: false, isDefault: true }] },
    ]),
  ).toThrow();
});
it("requires explicit selected group acknowledgement and never approves invalid or unselected products", () => {
  const r = review();
  expect(() => approveSelectedImportItems(r, ["i0"], "EUR", false)).toThrow();
  expect(() => approveSelectedImportItems(r, ["other"], "EUR", true)).toThrow();
  const result = approveSelectedImportItems(r, ["i0", "i1"], "EUR", true);
  expect(result.blocked).toEqual(["i1"]);
  expect(result.review.items[0]).toMatchObject({
    action: "ADD",
    approvePrice: true,
    approveConfiguration: true,
  });
  expect(result.review.items[1]).toMatchObject({
    action: "PENDING",
    approvePrice: false,
    item: { priceMinor: null },
  });
  expect(r.items[0]!.approvePrice).toBe(false);
  expect(
    approveSelectedImportItems(r, ["i0"], "EUR", true).review.items[1],
  ).toEqual(r.items[1]);
});
