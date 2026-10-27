import { z } from "zod";
export const websiteAiRequestSchema = z.strictObject({
  requestKey: z.string().uuid(),
  instruction: z.string().trim().min(3).max(1000),
  locale: z.enum(["sq", "de", "en", "it"]),
  expectedUpdatedAt: z.iso.datetime(),
});
export const websiteAiCopySchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(280),
});
