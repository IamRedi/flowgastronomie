import { afterEach, expect, it, vi } from "vitest";
import { cacheReview, cachedReview, sameReview } from "./review-cache";
import type { BusinessReview } from "@flowgastronomie/domain";
afterEach(() => vi.unstubAllGlobals());
it("retains scoped unsaved review through refresh but never restores confirmation or accepts credential payloads", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    setItem: (k: string, v: string) => values.set(k, v),
    getItem: (k: string) => values.get(k) ?? null,
    removeItem: (k: string) => values.delete(k),
  });
  const review: BusinessReview = {
    expectedVersion: 1,
    canonicalRevision: "a".repeat(64),
    confirm: true,
    fields: [],
    items: [],
    media: [],
    premiumStyleId: null,
  };
  cacheReview("authorized-import", review);
  expect(cachedReview("authorized-import")?.confirm).toBe(false);
  expect(cachedReview("other-import")).toBeNull();
  expect(
    sameReview(review, { ...review, expectedVersion: 2, confirm: false }),
  ).toBe(true);
  values.set(
    "flowgastronomie.import-review.bad",
    JSON.stringify({ ...review, password: "must-not-be-cached" }),
  );
  expect(cachedReview("bad")).toBeNull();
});
