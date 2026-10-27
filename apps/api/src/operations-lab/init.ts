import { spawnCommandSync } from "../../../../tests/operations/process-command.mjs";
import { prisma } from "@flowgastronomie/database";
import { readFile } from "node:fs/promises";
import { assertLabInstance } from "./guard.js";
await assertLabInstance();
// Trusted repository-owned DDL only; never interpolates user text or business data.
await prisma.$executeRawUnsafe(
  await readFile("tools/operations-lab/scope-constraints.sql", "utf8"),
);
const result = spawnCommandSync(
  "npx",
  [
    "prisma",
    "migrate",
    "deploy",
    "--schema",
    "packages/database/prisma/schema.prisma",
  ],
  { stdio: "inherit" },
);
await prisma.$executeRawUnsafe(
  "DO $$ BEGIN\n" +
    (await readFile("tools/operations-lab/runtime.sql", "utf8")) +
    "\nEND $$;",
);
await prisma.$executeRawUnsafe(
  "DO $$ BEGIN\n" +
    (await readFile("tools/operations-lab/continuity.sql", "utf8")) +
    "\nEND $$;",
);
await prisma.$disconnect();
if (result.status !== 0) process.exitCode = 1;
