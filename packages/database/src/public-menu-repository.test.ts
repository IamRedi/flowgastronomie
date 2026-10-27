import { describe, expect, it } from "vitest";

import { hashQrToken } from "./public-menu-repository.js";

describe("hashQrToken", () => {
  it("creates a stable one-way lookup value without storing the raw token", () => {
    expect(hashQrToken("demo-table-07")).toBe(
      "fb4a125d2b3301c2f468dd643db1c36a9e90980579c6334f6981e32aed729de2",
    );
    expect(hashQrToken("demo-table-07")).not.toContain("demo-table-07");
  });
});
