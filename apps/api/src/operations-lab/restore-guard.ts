import { readFile } from "node:fs/promises";
import { prisma } from "@flowgastronomie/database";
import { LAB_MARKER } from "./guard.js";
export const restoreDatabase =
  "postgresql://operations_lab_restore:operations_lab_restore_local_only@127.0.0.1:55441/restaurantflow_operations_lab_restore?schema=public";
export function assertRestoreEndpoint(env = process.env) {
  if (
    env.NODE_ENV === "production" ||
    env.OPERATIONS_LAB_ENABLED !== "true" ||
    env.LAB_DISPOSABLE_RESTORE !== "true" ||
    env.DATABASE_URL !== restoreDatabase
  )
    throw new Error("LAB_DISPOSABLE_RESTORE_TARGET_FORBIDDEN");
}
export async function assertReviewedRestore() {
  assertRestoreEndpoint();
  const approval = JSON.parse(
    await readFile(process.env.LAB_RESTORE_REVIEW!, "utf8"),
  ) as {
    version: number;
    marker: string;
    targetIdentifier: string;
    sourceIdentifier: string;
    database: string;
    reason: string;
  };
  if (
    approval.version !== 1 ||
    approval.marker !== LAB_MARKER ||
    approval.database !== restoreDatabase ||
    approval.targetIdentifier === approval.sourceIdentifier ||
    !approval.reason
  )
    throw new Error("LAB_RESTORE_ENROLLMENT_INVALID");
  const rows = await prisma.$queryRaw<
    Array<{ valid: boolean }>
  >`SELECT current_database()='restaurantflow_operations_lab_restore' AND current_user='operations_lab_restore' AND i.marker=${LAB_MARKER} AND i.system_identifier=${approval.targetIdentifier} AND c.system_identifier::text=${approval.targetIdentifier} AS valid FROM operations_lab.instance i CROSS JOIN pg_control_system() c`;
  if (rows.length !== 1 || !rows[0]!.valid)
    throw new Error("LAB_RESTORE_IDENTITY_REJECTED");
  return approval;
}
