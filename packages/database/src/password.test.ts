import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password.js";

describe("staff password hashing", () => {
  it("verifies the correct password without storing it", async () => {
    const hash = await hashPassword("Correct horse battery staple");

    expect(hash).not.toContain("Correct horse battery staple");
    await expect(
      verifyPassword("Correct horse battery staple", hash),
    ).resolves.toBe(true);
  });

  it("rejects a wrong password and malformed hashes", async () => {
    const hash = await hashPassword("right-password");

    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
    await expect(verifyPassword("right-password", "invalid")).resolves.toBe(
      false,
    );
  });
});
