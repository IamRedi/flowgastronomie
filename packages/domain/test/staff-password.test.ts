import { it, expect } from "vitest";
import { staffPasswordChangeSchema } from "../src/staff-password";
it("requires a different bounded password without admitting a target identity", () => {
  expect(
    staffPasswordChangeSchema.safeParse({
      currentPassword: "old-test-only",
      newPassword: "x".repeat(129),
    }).success,
  ).toBe(false);
  expect(
    staffPasswordChangeSchema.safeParse({
      currentPassword: "old-test-only",
      newPassword: "new-test-only-strong",
    }).success,
  ).toBe(true);
  expect(
    staffPasswordChangeSchema.safeParse({
      currentPassword: "old-test-only",
      newPassword: "old-test-only",
    }).success,
  ).toBe(false);
  expect(
    staffPasswordChangeSchema.safeParse({
      currentPassword: "old-test-only",
      newPassword: "new-test-only-strong",
      userId: "someone-else",
    }).success,
  ).toBe(false);
});
