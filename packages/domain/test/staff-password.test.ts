import { it, expect } from "vitest";
import {
  staffPasswordChangeSchema,
  staffPasswordResetSchema,
  STAFF_PASSWORD_RESET_LIFETIME_MS,
} from "../src/staff-password";
it("requires an opaque recovery proof and a bounded password, never a caller-selected identity", () => {
  const input = {
    token: "a".repeat(43),
    newPassword: "new-test-only-password",
  };
  expect(staffPasswordResetSchema.safeParse(input).success).toBe(true);
  for (const bad of [
    { ...input, token: "123" },
    { ...input, newPassword: "short" },
    { ...input, newPassword: "x".repeat(129) },
    { ...input, tenantId: "foreign" },
  ])
    expect(staffPasswordResetSchema.safeParse(bad).success).toBe(false);
  expect(STAFF_PASSWORD_RESET_LIFETIME_MS).toBe(30 * 60_000);
});
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
