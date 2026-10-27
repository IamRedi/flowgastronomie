import { describe, expect, it } from "vitest";
import {
  posRecoveryKey,
  readPosRecovery,
  type PosRecovery,
} from "./pos-recovery";
const draft: PosRecovery = {
  version: 1,
  savedAt: 1000,
  key: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  locale: "sq",
  orderType: "DINE_IN",
  tableId: "table-al",
  pending: true,
  cart: [
    {
      key: "line",
      productId: "pizza",
      productName: "Pica ë ç",
      quantity: 2,
      unitPriceMinor: 180000,
      variantName: "E madhe",
      modifierOptionIds: ["extra"],
      modifiersLabel: "Djathë",
      notes: "Pa qepë",
    },
  ],
};
describe("POS recovery", () => {
  it("retains the exact key, original locale and item choices after uncertain submission", () => {
    expect(readPosRecovery(JSON.stringify(draft), 2000)).toEqual(draft);
    // An uncertain order must not silently become a new submission after session expiry.
    expect(readPosRecovery(JSON.stringify(draft), 1000 + 24 * 3600000)).toEqual(
      draft,
    );
  });
  it("separates tenants, venues and individual staff", () => {
    const scope = {
      tenantId: "de",
      venueId: "one",
      email: "waiter@demo.invalid",
    };
    const key = posRecoveryKey(scope);
    expect(posRecoveryKey({ ...scope, tenantId: "al" })).not.toBe(key);
    expect(posRecoveryKey({ ...scope, venueId: "two" })).not.toBe(key);
    expect(
      posRecoveryKey({ ...scope, email: "manager@demo.invalid" }),
    ).not.toBe(key);
  });
  it("rejects expired drafts, corrupt and excessive cache data", () => {
    expect(
      readPosRecovery(
        JSON.stringify({ ...draft, pending: false }),
        24 * 3600000,
      ),
    ).toBeNull();
    for (const raw of [
      "{",
      "null",
      JSON.stringify({ ...draft, cart: [{}] }),
      JSON.stringify({ ...draft, cart: [{ ...draft.cart[0], quantity: -1 }] }),
      JSON.stringify({
        ...draft,
        cart: [{ ...draft.cart[0], notes: "x".repeat(201) }],
      }),
      "x".repeat(100001),
    ])
      expect(readPosRecovery(raw, 2000)).toBeNull();
  });
});
