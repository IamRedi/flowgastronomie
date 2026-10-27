import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawnCommandSync } from "../operations/process-command.mjs";
const require = createRequire(import.meta.url),
  { PrismaClient } = require("@prisma/client");
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !/^postgres(ql)?:$/.test(url.protocol)
)
  throw new Error("Workforce tests require local PostgreSQL");
const schema = "workforce_wf2_gate_" + Date.now();
url.searchParams.set("schema", schema);
const env = {
  ...process.env,
  DATABASE_URL: url.toString(),
  WORKFORCE_WF2_DB_GATE: "true",
  WORKFORCE_DOCUMENT_KEY: randomBytes(32).toString("base64"),
  TRANSACTIONAL_EMAIL_PROVIDER: "disabled",
};
const db = new PrismaClient({ datasourceUrl: url.toString() });
try {
  const migrate = spawnCommandSync(
    process.execPath,
    [
      require.resolve("prisma/build/index.js"),
      "migrate",
      "deploy",
      "--schema",
      "packages/database/prisma/schema.prisma",
    ],
    { env, stdio: "inherit" },
  );
  if (migrate.status !== 0) throw new Error("Workforce migration failed");
  const tests = spawnCommandSync(
    process.execPath,
    [
      join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"),
      "run",
      "src/workforce-operations.integration.test.ts",
    ],
    { env, cwd: "apps/api", stdio: "inherit" },
  );
  process.exitCode = tests.status ?? 1;
} finally {
  if (!/^workforce_wf2_gate_\d+$/.test(schema))
    throw new Error("Invalid fixture schema");
  await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
  await db.$disconnect();
}
