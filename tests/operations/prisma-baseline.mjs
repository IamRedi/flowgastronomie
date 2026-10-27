import { readFileSync } from "node:fs";
import { join } from "node:path";

// The public repository starts without the private pre-release history, so
// the Prisma schema at each upgrade baseline is vendored here. Migration SQL
// has not changed since those baselines and is read from packages/database.
const root = join(import.meta.dirname, "../fixtures/prisma-baselines");

export function baselineSchema(revision) {
  return readFileSync(join(root, revision, "schema.prisma"));
}

export function baselineMigrations(revision) {
  return readFileSync(join(root, revision, "migrations.txt"), "utf8")
    .trim()
    .split("\n");
}
