import { z } from "zod";
export const websiteImportRequestSchema = z.strictObject({
  url: z.url().max(2048),
  authorized: z.literal(true),
});
export const websiteCopyProposalSchema = z.strictObject({
  sourceUrl: z.url().max(2048),
  title: z.string().max(120),
  description: z.string().max(280),
  fetchedAt: z.iso.datetime(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  confidence: z.literal("UNVERIFIED"),
});
