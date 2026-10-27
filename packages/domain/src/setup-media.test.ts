import { expect, it } from "vitest";
import {
  assertSetupMediaCommit,
  setupMediaAssignmentsSchema,
  setupMediaProgress,
  compactMediaAssignments,
  placeSetupPhoto,
} from "./setup-media";
const venue = {
  assetId: "logo",
  productId: null,
  role: "LOGO" as const,
  sortOrder: 0,
};
it("retains gallery position on replace and requires a manual primary choice for generated replacements", () => {
  const first = { ...venue, productId: "p", role: "GALLERY" as const };
  const second = { ...first, assetId: "second", sortOrder: 1 };
  expect(
    placeSetupPhoto([first, second], {
      assetId: "new",
      source: "UPLOAD",
      productId: "p",
      role: "GALLERY",
      replace: first,
    }),
  ).toEqual([{ ...first, assetId: "new" }, second]);
  const primary = { ...first, role: "PRIMARY" as const };
  expect(
    placeSetupPhoto([primary], {
      assetId: "ai",
      source: "GENERATED",
      productId: "p",
      role: "GALLERY",
      replace: primary,
    })[0]?.role,
  ).toBe("GALLERY");
});
it("validates unique scoped photo positions without implicit primary promotion", () => {
  expect(setupMediaAssignmentsSchema.parse([venue])).toEqual([venue]);
  expect(
    setupMediaAssignmentsSchema.parse([venue, { ...venue, role: "HERO" }]),
  ).toHaveLength(2);
  expect(
    placeSetupPhoto([venue], {
      assetId: venue.assetId,
      productId: null,
      role: "HERO",
      source: "UPLOAD",
    }),
  ).toEqual([venue, { ...venue, role: "HERO" }]);
  for (const rows of [
    [venue, venue],
    [{ ...venue, productId: "product" }],
    [{ ...venue, role: "PRIMARY" }],
    [{ ...venue, sortOrder: 1 }],
  ]) {
    expect(() => setupMediaAssignmentsSchema.parse(rows)).toThrow();
  }
  const gallery = [
    { ...venue, productId: "p", role: "GALLERY" as const, sortOrder: 7 },
  ];
  expect(compactMediaAssignments(gallery)).toEqual([
    { ...gallery[0], sortOrder: 0 },
  ]);
});
it("records MEDIA only on explicit completion or skip and retains other choices", () => {
  expect(setupMediaProgress(["MENU", "TEAM"], "SKIP")).toEqual({
    mediaStep: 4,
    mediaStatus: "SKIPPED",
    skipped: ["MENU", "TEAM", "MEDIA"],
  });
  expect(setupMediaProgress(["MENU", "MEDIA"], "SAVE")).toEqual({
    mediaStep: 4,
    mediaStatus: "COMPLETE",
    skipped: ["MENU"],
  });
});
it("requires final review and rejects stale canonical associations", () => {
  expect(() => assertSetupMediaCommit(4, true, "same", "same")).not.toThrow();
  expect(() => assertSetupMediaCommit(3, true, "same", "same")).toThrow(
    "Review",
  );
  expect(() => assertSetupMediaCommit(4, false, "same", "same")).toThrow(
    "Review",
  );
  expect(() => assertSetupMediaCommit(4, true, "new", "old")).toThrow(
    "another workspace",
  );
});
