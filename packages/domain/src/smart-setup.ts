import { z } from "zod";
import {
  businessProfileIds,
  businessProfileDefaults,
} from "./business-profile";

export class SetupImportError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "CONFLICT"
      | "INVALID_INPUT"
      | "REVIEW_REQUIRED"
      | "UNAVAILABLE"
      | "LIMIT",
    message: string = code,
  ) {
    super(message);
  }
}
export const setupOptionalSteps = ["MENU", "MEDIA", "TEAM"] as const;
export const smartSetupUpdateSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  profileId: z.enum(businessProfileIds),
  applyCategories: z.boolean(),
  step: z.number().int().min(1).max(4),
  skipped: z.array(z.enum(setupOptionalSteps)).max(3),
  complete: z.boolean(),
});
export type SmartSetupUpdate = z.infer<typeof smartSetupUpdateSchema>;
export function smartSetupTransition(
  input: SmartSetupUpdate,
  hasImportedMenu: boolean,
) {
  const value = smartSetupUpdateSchema.parse(input);
  if (new Set(value.skipped).size !== value.skipped.length)
    throw new SetupImportError("INVALID_INPUT");
  if (
    value.complete &&
    (value.step !== 4 || (!hasImportedMenu && !value.skipped.includes("MENU")))
  )
    throw new SetupImportError(
      "REVIEW_REQUIRED",
      "Import a reviewed menu or explicitly skip it before finishing setup.",
    );
  return {
    profileId: value.profileId,
    profileVersion: businessProfileDefaults(value.profileId).version,
    step: value.step,
    skipped: value.skipped,
    status: value.complete ? ("READY" as const) : ("IN_PROGRESS" as const),
  };
}
