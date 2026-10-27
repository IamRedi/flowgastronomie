import { statfs } from "node:fs/promises";
import { z } from "zod";
import { prisma } from "@flowgastronomie/database";
import { assertLabInstance } from "./guard.js";
export function labStoragePolicy(env = process.env) {
  return z
    .strictObject({
      maxFiles: z.coerce.number().int().min(100).max(1000000),
      maxBytes: z.coerce.number().int().min(10000000).max(1000000000000),
      warningRatio: z.coerce.number().min(0.5).max(0.95),
      reserveBytes: z.coerce.number().int().min(100000000).max(10000000000),
    })
    .parse({
      maxFiles: env.LAB_PDF_MAX_FILES ?? 50000,
      maxBytes: env.LAB_PDF_MAX_BYTES ?? 5000000000,
      warningRatio: env.LAB_PDF_WARNING_RATIO ?? 0.8,
      reserveBytes: env.LAB_PDF_RESERVE_BYTES ?? 250000000,
    });
}
export async function labStorageStatus(root: string) {
  await assertLabInstance();
  const policy = labStoragePolicy();
  const rows = await prisma.$queryRaw<
    Array<{ files: bigint; bytes: bigint }>
  >`SELECT count(*) AS files,coalesce(sum(byte_size),0)::bigint AS bytes FROM operations_lab.archive`;
  const files = Number(rows[0]!.files),
    bytes = Number(rows[0]!.bytes);
  const disk = await statfs(root),
    freeBytes = disk.bavail * disk.bsize;
  return {
    policy,
    files,
    bytes,
    freeBytes,
    warning:
      files >= policy.maxFiles * policy.warningRatio ||
      bytes >= policy.maxBytes * policy.warningRatio ||
      freeBytes < policy.reserveBytes * 2,
    full:
      files >= policy.maxFiles ||
      bytes >= policy.maxBytes ||
      freeBytes < policy.reserveBytes,
  };
}
