import { z } from "zod";
export const STAFF_PASSWORD_RESET_LIFETIME_MS = 30 * 60 * 1000;
export const STAFF_PASSWORD_RESET_COOLDOWN_MS = 5 * 60 * 1000;
export const staffPasswordResetSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  newPassword: z.string().min(12).max(128),
});
export const staffPasswordChangeSchema = z
  .strictObject({
    currentPassword: z.string().min(8).max(128),
    newPassword: z.string().min(12).max(128),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "Choose a different password",
  });
