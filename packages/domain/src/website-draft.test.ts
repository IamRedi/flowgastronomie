import { expect, it } from "vitest";
import {
  assertWebsiteDraftVersion,
  websiteRevertSchema,
} from "./website-draft";
it("requires explicit confirmation and rejects stale or absent draft revisions", () => {
  const now = new Date("2026-10-08T12:00:00.000Z");
  expect(() => assertWebsiteDraftVersion(now.toISOString(), now)).not.toThrow();
  expect(() => assertWebsiteDraftVersion(now.toISOString(), null)).toThrow();
  expect(() =>
    assertWebsiteDraftVersion("2026-10-07T12:00:00.000Z", now),
  ).toThrow();
  expect(
    websiteRevertSchema.safeParse({
      revisionId: "a",
      expectedUpdatedAt: now.toISOString(),
      confirmed: false,
    }).success,
  ).toBe(false);
});
