import { z } from "zod";

// Scenario evidence and scheduling contracts, never a financial ledger.
export const labRunSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().min(1),
  tenantId: z.string().min(1),
  venueId: z.string().min(1),
  scenarioVersion: z.string().min(1).max(80),
  seed: z.number().int().nonnegative(),
  businessDate: z.iso.date(),
  status: z.enum([
    "RUNNING",
    "PAUSED",
    "NEEDS_REVIEW",
    "COMPLETED",
    "STOP_AFTER_SHIFT",
  ]),
  checkpoint: z.record(z.string(), z.unknown()),
});
export const labActionSchema = z.strictObject({
  version: z.literal(1),
  eventId: z.string().min(1),
  runId: z.string().min(1),
  tenantId: z.string().min(1),
  venueId: z.string().min(1),
  actor: z.string().min(1),
  kind: z.string().min(1),
  dueAt: z.iso.datetime(),
  status: z.enum(["PENDING", "LEASED", "SUCCEEDED", "NEEDS_REVIEW", "FAILED"]),
  attempts: z.number().int().min(0).max(3),
  leaseOwner: z.string().nullable(),
  leaseUntil: z.iso.datetime().nullable(),
  idempotencyKey: z.string().min(8).max(100),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  expected: z.record(z.string(), z.unknown()),
  resultSourceIds: z.array(z.string()),
});
export type LabRun = z.infer<typeof labRunSchema>;
export function labReplayPolicy(
  status: string,
  idempotent: boolean,
): "RETURN" | "EXECUTE" | "REVIEW" {
  if (status === "SUCCEEDED") return "RETURN";
  if (["NEEDS_REVIEW", "FAILED"].includes(status)) return "REVIEW";
  if (status === "LEASED" && !idempotent) return "REVIEW";
  return ["PENDING", "LEASED"].includes(status) ? "EXECUTE" : "REVIEW";
}
export function assertLabRunTransition(
  from: LabRun["status"],
  to: LabRun["status"],
) {
  const transitions: Record<LabRun["status"], LabRun["status"][]> = {
    RUNNING: ["PAUSED", "NEEDS_REVIEW", "COMPLETED", "STOP_AFTER_SHIFT"],
    PAUSED: ["RUNNING", "NEEDS_REVIEW"],
    NEEDS_REVIEW: ["PAUSED", "COMPLETED"],
    STOP_AFTER_SHIFT: ["COMPLETED", "NEEDS_REVIEW"],
    COMPLETED: [],
  };
  if (!transitions[from].includes(to))
    throw new Error("Invalid lab run transition");
}
export function assertLabCompletion(
  status: LabRun["status"],
  unresolvedActions: number,
  discrepancies: number,
) {
  assertLabRunTransition(status, "COMPLETED");
  if (unresolvedActions !== 0 || discrepancies !== 0)
    throw new Error("Lab evidence is incomplete");
}
