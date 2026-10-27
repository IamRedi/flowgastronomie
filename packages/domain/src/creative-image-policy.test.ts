import { expect, it } from "vitest";
import {
  creativeImageOutputPolicy,
  creativeReviewDisclosure,
  canReviewGeneratedCreativeAsset,
} from "./creative-image-policy";

it("chooses print-quality landscape for A4 and square for social/stickers", () => {
  expect(creativeImageOutputPolicy({ format: "A4" })).toEqual({
    width: 1536,
    height: 1024,
    quality: "high",
    purpose: "PRINT_HERO",
  });
  for (const format of ["SOCIAL", "STICKER"] as const)
    expect(creativeImageOutputPolicy({ format })).toMatchObject({
      width: 1024,
      height: 1024,
      quality: "medium",
    });
});
it("permits generated internal proofs only in demo/pilot scopes and labels AI separately from DEMO", () => {
  expect(canReviewGeneratedCreativeAsset("LOCAL_PILOT", "GENERATED")).toBe(
    true,
  );
  expect(canReviewGeneratedCreativeAsset("DEMO", "GENERATED")).toBe(true);
  expect(canReviewGeneratedCreativeAsset("REAL", "GENERATED")).toBe(false);
  expect(canReviewGeneratedCreativeAsset("LOCAL_PILOT", "UPLOAD")).toBe(false);
  expect(creativeReviewDisclosure(false, true, true)).toBe(
    "INTERNAL REVIEW · AI-generated image · not actual venue food · SAMPLE PRICE",
  );
  expect(creativeReviewDisclosure(true, false, true)).toBe(
    "INTERNAL REVIEW · DEMO image · SAMPLE PRICE",
  );
});
