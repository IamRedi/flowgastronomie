import { z } from "zod";
export const mediaSources = [
  "UPLOAD",
  "IMPORT",
  "GENERATED",
  "DEMO",
  "SYSTEM",
] as const;
export const mediaProvenanceSchema = z.strictObject({
  source: z.enum(mediaSources),
  description: z.string().trim().min(1).max(1000),
  sourceUrl: z.url().max(2048).optional(),
  importSessionId: z.string().min(1).max(100).optional(),
  originalAssetId: z.string().max(200).optional(),
  originalContentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  inputContentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  transformation: z.literal("EDGE_CONNECTED_BLACK_TO_ALPHA_V1").optional(),
  provider: z.string().max(100).optional(),
  model: z.string().max(200).optional(),
  promptHash: z.string().max(128).optional(),
  generatedAt: z.iso.datetime().optional(),
});
export type MediaProvenance = z.infer<typeof mediaProvenanceSchema>;
export type CanonicalMediaReference = {
  id: string;
  url: string;
  source: MediaProvenance["source"];
  label: string | null;
  width: number;
  height: number;
  contentHash: string;
  approvedForPublicUse: boolean;
};
export function mediaDisclosure(
  source: MediaProvenance["source"],
): string | null {
  return source === "DEMO"
    ? "DEMO illustration"
    : source === "GENERATED"
      ? "AI-generated illustration"
      : null;
}
export function assertMediaApproval(
  provenance: MediaProvenance,
  approvedForPublicUse: boolean,
  confirmed: boolean,
) {
  mediaProvenanceSchema.parse(provenance);
  if (
    provenance.transformation &&
    (!provenance.originalAssetId ||
      !provenance.originalContentHash ||
      !provenance.inputContentHash)
  )
    throw new Error(
      "A derivative requires its immutable original and input hashes.",
    );
  if (!confirmed) throw new Error("Explicit media approval is required.");
  if (provenance.source === "DEMO" && approvedForPublicUse)
    throw new Error("Demo media is for internal review only.");
  if (
    provenance.source === "GENERATED" &&
    (!provenance.originalAssetId || !provenance.provider || !provenance.model)
  )
    throw new Error(
      "Generated media requires its original asset and provider provenance.",
    );
}
