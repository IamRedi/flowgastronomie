import { z } from "zod";
import { SetupImportError } from "./smart-setup";
export const websiteRevertSchema = z.strictObject({
  revisionId: z.string().min(1).max(128),
  expectedUpdatedAt: z.iso.datetime(),
  confirmed: z.literal(true),
});
export function assertWebsiteDraftVersion(
  expected: string | undefined,
  actual: Date | null,
) {
  if (expected !== undefined && expected !== actual?.toISOString())
    throw new SetupImportError(
      "CONFLICT",
      "The website changed. Reload before saving or restoring a revision.",
    );
}
