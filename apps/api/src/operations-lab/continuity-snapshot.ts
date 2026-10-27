import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@flowgastronomie/database";
import { assertLabInstance, LAB_MARKER } from "./guard.js";
const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export async function snapshotDatabase() {
  const tables = await prisma.$queryRaw<
    Array<{ schemaname: string; tablename: string }>
  >`SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','operations_lab') AND tablename<>'instance' ORDER BY schemaname,tablename`;
  const result: Record<string, { rows: number; hash: string }> = {};
  for (const t of tables) {
    const name =
      '"' +
      t.schemaname.replaceAll('"', '""') +
      '"."' +
      t.tablename.replaceAll('"', '""') +
      '"';
    const rows = await prisma.$queryRawUnsafe<Array<{ row: string }>>(
      `SELECT to_jsonb(t)::text AS row FROM ${name} t ORDER BY to_jsonb(t)::text`,
    );
    const hash = createHash("sha256");
    for (const r of rows) hash.update(r.row + "\n");
    result[t.schemaname + "." + t.tablename] = {
      rows: rows.length,
      hash: hash.digest("hex"),
    };
  }
  return result;
}
export async function fileManifest(root: string) {
  const files: Record<string, string> = {};
  async function visit(dir: string, prefix: string) {
    for (const f of await readdir(dir, { withFileTypes: true })) {
      if (f.isSymbolicLink()) throw new Error("LAB_BACKUP_SYMLINK_FORBIDDEN");
      if (f.isDirectory())
        await visit(join(dir, f.name), prefix + f.name + "/");
      else files[prefix + f.name] = sha(await readFile(join(dir, f.name)));
    }
  }
  await visit(root, "");
  return Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
  );
}
if (process.argv[2] === "source") {
  try {
    await assertLabInstance();
    const scoped = await prisma.$queryRaw<
      Array<{ profile: string; tenant_id: string; venue_id: string }>
    >`SELECT profile,tenant_id,venue_id FROM operations_lab.venue ORDER BY profile`;
    const identity = await prisma.$queryRaw<
      Array<{ system_identifier: string }>
    >`SELECT system_identifier::text FROM pg_control_system()`;
    const pdfFiles = await fileManifest("artifacts/operations-lab/receipts");
    const archived = await prisma.$queryRaw<
      Array<{ filename: string; content_hash: string }>
    >`SELECT filename,content_hash FROM operations_lab.archive`;
    for (const a of archived)
      if (
        !/^[a-f0-9]{64}\.pdf$/.test(a.filename) ||
        pdfFiles[a.filename] !== a.content_hash
      )
        throw new Error("LAB_BACKUP_PDF_HASH_MISMATCH");
    const manifest = {
      version: 1,
      marker: LAB_MARKER,
      identity: identity[0]!.system_identifier,
      scopes: scoped,
      tables: await snapshotDatabase(),
      privateFiles: await fileManifest(".operations-lab"),
      pdfFiles,
    };
    await writeFile(process.argv[3]!, JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
    console.log(
      "Source fingerprint captured without changing business records",
    );
  } finally {
    await prisma.$disconnect();
  }
}
