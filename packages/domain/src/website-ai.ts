import { z } from "zod";
import { aiTextActions } from "./website-document";
export const websiteAiRequestSchema = z
  .strictObject({
    requestKey: z.string().uuid(),
    instruction: z.string().trim().min(3).max(1000),
    locale: z.enum(["sq", "de", "en", "it"]),
    expectedUpdatedAt: z.iso.datetime(),
    operation: z.enum(["SITE", "SECTION"]).optional(),
    sectionId: z.string().max(80).optional(),
    action: z.enum(aiTextActions).optional(),
    sourceLocale: z.enum(["sq", "de", "en", "it"]).optional(),
    description: z.string().trim().max(1000).optional(),
    businessType: z.string().trim().max(80).optional(),
    includeImage: z.boolean().optional(),
    designOnly: z.boolean().optional(),
  })
  .refine(
    (input) => !input.designOnly || input.operation === "SITE",
    "Design-only proposals require a site operation",
  );
export const websiteAiCopySchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(280),
});
export const websiteAiSectionCopySchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000),
});
