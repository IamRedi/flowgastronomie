import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawnCommandSync } from "../operations/process-command.mjs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const source = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(source.hostname))
  throw new Error("Foundation gates require local PostgreSQL");
const milestone = process.argv[2] ?? "bf1";
if (!/^bf[1-5]$/.test(milestone)) throw new Error("Unknown milestone");
const schema = `foundation_gate_${Date.now()}`;
source.searchParams.set("schema", schema);
const env = {
  ...process.env,
  DATABASE_URL: source.toString(),
  FOUNDATION_DB_GATE: "true",
};
const client = new PrismaClient({ datasourceUrl: source.toString() });
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
  if (migrate.status !== 0) throw new Error("Gate migrations failed");
  const result = spawnCommandSync(
    process.execPath,
    [
      join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"),
      "run",
      `src/foundation-${milestone}.integration.test.ts`,
    ],
    {
      cwd: milestone === "bf5" ? "apps/api" : "packages/database",
      env,
      stdio: "inherit",
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  if (!/^foundation_gate_\d+$/.test(schema))
    throw new Error("Unexpected gate schema");
  await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.$disconnect();
}
