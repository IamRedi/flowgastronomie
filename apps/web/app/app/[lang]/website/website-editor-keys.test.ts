import { describe, expect, it } from "vitest";

import { websiteAssetInputKey } from "./website-editor-keys";

describe("website asset input keys", () => {
  it("keeps empty logo and hero inputs uniquely identified", () => {
    expect(websiteAssetInputKey("logoUrl", null)).not.toBe(
      websiteAssetInputKey("heroImageUrl", null),
    );
  });

  it("changes the key after an uploaded asset updates the input", () => {
    expect(websiteAssetInputKey("logoUrl", null)).not.toBe(
      websiteAssetInputKey("logoUrl", "/v1/public/website-assets/logo"),
    );
  });
});
