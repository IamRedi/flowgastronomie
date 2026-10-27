import { z } from "zod";
export const staffPasswordChangeSchema = z
  .strictObject({
    currentPassword: z.string().min(8).max(128),
    newPassword: z.string().min(12).max(128),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "Choose a different password",
  });
