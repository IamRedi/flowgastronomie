import { z } from "zod";
import { SetupImportError } from "./smart-setup";

export const setupMediaAssignmentSchema = z
  .strictObject({
    assetId: z.string().min(1).max(100),
    productId: z.string().min(1).max(100).nullable(),
    role: z.enum(["LOGO", "HERO", "PROFILE", "PRIMARY", "GALLERY"]),
    sortOrder: z.number().int().min(0).max(99),
  })
  .refine(
    (row) =>
      (row.productId
        ? ["PRIMARY", "GALLERY"]
        : ["LOGO", "HERO", "PROFILE", "GALLERY"]
      ).includes(row.role) &&
      (row.role === "GALLERY" || row.sortOrder === 0),
    "Choose a valid venue or product photo position.",
  );
export type SetupMediaAssignment = z.infer<typeof setupMediaAssignmentSchema>;
export const setupMediaAssignmentsSchema = z
  .array(setupMediaAssignmentSchema)
  .max(500)
  .superRefine((rows, ctx) => {
    const positions = new Set<string>(),
      assets = new Set<string>();
    for (const [index, row] of rows.entries()) {
      const slot = `${row.productId ?? "venue"}:${row.role}:${row.sortOrder}`;
      const asset = `${row.productId ?? `venue:${row.role}`}:${row.assetId}`;
      if (positions.has(slot) || assets.has(asset))
        ctx.addIssue({
          code: "custom",
          path: [index],
          message: "A photo or position is repeated for this target.",
        });
      positions.add(slot);
      assets.add(asset);
    }
  });
export const setupMediaDraftSchema = z.strictObject({
  baseRevision: z.string().regex(/^[a-f0-9]{64}$/),
  assignments: setupMediaAssignmentsSchema,
});
export const setupMediaUpdateSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  step: z.number().int().min(1).max(4),
  assignments: setupMediaAssignmentsSchema,
});
export const setupMediaConfirmSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  confirm: z.literal(true),
});
export const setupMediaUploadSchema = z.strictObject({
  source: z.enum(["UPLOAD", "DEMO"]),
  publicUse: z.enum(["true", "false"]).transform((v) => v === "true"),
  confirmed: z.literal("true"),
});
export function setupMediaProgress(skipped: string[], action: "SAVE" | "SKIP") {
  return {
    mediaStep: 4,
    mediaStatus: action === "SAVE" ? "COMPLETE" : "SKIPPED",
    skipped:
      action === "SAVE"
        ? skipped.filter((s) => s !== "MEDIA")
        : [...new Set([...skipped, "MEDIA"])],
  };
}
export function assertSetupMediaCommit(
  step: number,
  confirmed: boolean,
  currentRevision: string,
  baseRevision: string,
) {
  if (step !== 4 || !confirmed)
    throw new SetupImportError(
      "REVIEW_REQUIRED",
      "Review the photos before saving.",
    );
  if (currentRevision !== baseRevision)
    throw new SetupImportError(
      "CONFLICT",
      "Photos changed in another workspace. Reload the current photos before saving.",
    );
}
/** Reordering is local to one gallery; primary photos never move implicitly. */
export function compactMediaAssignments(rows: SetupMediaAssignment[]) {
  const positions = new Map<string, number>();
  return rows.map((row) => {
    const group = `${row.productId ?? "venue"}:${row.role}`;
    const sortOrder = row.role === "GALLERY" ? (positions.get(group) ?? 0) : 0;
    positions.set(group, sortOrder + 1);
    return { ...row, sortOrder };
  });
}

export function placeSetupPhoto(
  rows: SetupMediaAssignment[],
  input: {
    assetId: string;
    source: string;
    productId: string | null;
    role: SetupMediaAssignment["role"];
    replace?: SetupMediaAssignment | undefined;
  },
) {
  const role =
    input.source === "GENERATED" && input.replace?.role === "PRIMARY"
      ? "GALLERY"
      : (input.replace?.role ?? input.role);
  const replacement = rows.findIndex(
    (row) =>
      row.productId === input.productId &&
      (input.replace
        ? row.assetId === input.replace.assetId &&
          row.role === input.replace.role
        : input.role !== "GALLERY" && row.role === input.role),
  );
  const next: SetupMediaAssignment = {
    assetId: input.assetId,
    productId: input.productId,
    role,
    sortOrder: 0,
  };
  const result = rows.flatMap((row, index) =>
    index === replacement
      ? [next]
      : row.productId === input.productId &&
          row.assetId === input.assetId &&
          (input.productId !== null || row.role === input.role)
        ? []
        : [row],
  );
  if (replacement < 0) result.push(next);
  return compactMediaAssignments(result);
}
