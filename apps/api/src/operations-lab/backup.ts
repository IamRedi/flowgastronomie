import { openSync, closeSync } from "node:fs";
import { mkdir, cp, copyFile, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { prisma } from "@flowgastronomie/database";
import { assertLabInstance, hash } from "./guard.js";
import {
  archiveRoot,
  verifyArchive,
  type ArchiveEntry,
} from "./pdf-archive.js";
import { spawnCommandSync } from "../../../../tests/operations/process-command.mjs";
await assertLabInstance();
try {
  for (const port of [4400, 3400]) {
    try {
      await fetch(`http://127.0.0.1:${port}/health`);
      throw new Error("Stop lab API/web/worker before backup");
    } catch (e) {
      if ((e as Error).message.startsWith("Stop lab")) throw e;
    }
  }
  if (
    (await prisma.cashSession.count({ where: { status: "OPEN" } })) ||
    (await prisma.staffShift.count({ where: { status: "OPEN" } }))
  )
    throw new Error(
      "Close or review actual open shifts/registers before consistent backup",
    );
  const root = resolve(
    ".operations-lab-backups",
    new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-"),
  );
  await mkdir(join(root, "receipts"), { recursive: true, mode: 0o700 });
  const entries = await prisma.$queryRaw<
    ArchiveEntry[]
  >`SELECT * FROM operations_lab.archive ORDER BY tenant_id,venue_id,receipt_id`;
  const manifest = [];
  for (const e of entries) {
    const bytes = await verifyArchive(e);
    await copyFile(
      join(archiveRoot, e.filename),
      join(root, "receipts", e.filename),
    );
    manifest.push({
      receiptId: e.receipt_id,
      tenantId: e.tenant_id,
      venueId: e.venue_id,
      filename: e.filename,
      sourceHash: e.source_hash,
      contentHash: e.content_hash,
      bytes: bytes.length,
    });
  }
  const file = join(root, "database.dump"),
    fd = openSync(file, "wx", 0o600);
  try {
    const r = spawnCommandSync(
      "docker",
      [
        "compose",
        "-f",
        "compose.operations-lab.yaml",
        "exec",
        "-T",
        "postgres",
        "pg_dump",
        "-U",
        "operations_lab",
        "-d",
        "restaurantflow_operations_lab",
        "-Fc",
      ],
      { stdio: ["ignore", fd, "inherit"] },
    );
    if (r.status !== 0) throw new Error("LAB_BACKUP_DUMP_FAILED");
  } finally {
    closeSync(fd);
  }
  await cp(".operations-lab", join(root, "private"), { recursive: true });
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify(
      {
        version: 1,
        createdAt: new Date().toISOString(),
        databaseHash: hash(await readFile(file)),
        receipts: manifest,
        security:
          "Private backup contains only synthetic lab data and local credentials; protect with owner ACL/encryption.",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log("LAB backup verified at " + root);
} finally {
  await prisma.$disconnect();
}
