import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawnCommandSync } from "../operations/process-command.mjs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const source = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(source.hostname))
  throw new Error("Creative acceptance requires a local PostgreSQL instance.");
const schema = `creative_gate_${Date.now()}`;
source.searchParams.set("schema", schema);
const env = {
  ...process.env,
  DATABASE_URL: source.toString(),
  CREATIVE_PUBLIC_ORIGIN: "http://localhost:3400",
  CREATIVE_DB_GATE: "true",
  CREATIVE_STORAGE_DIR: join(
    process.cwd(),
    "artifacts",
    "creative-gate-assets",
  ),
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
  if (migrate.status !== 0) throw new Error("Acceptance migrations failed");
  const result = spawnCommandSync(
    process.execPath,
    [
      join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"),
      "run",
      "src/creative-repository.integration.test.ts",
    ],
    { cwd: "packages/database", env, stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
  if (result.status === 0) {
    const acceptance = spawnCommandSync(
      process.execPath,
      [
        join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"),
        "run",
        "src/creative-acceptance.integration.test.ts",
      ],
      { cwd: "apps/api", env, stdio: "inherit" },
    );
    process.exitCode = acceptance.status ?? 1;
  }
} finally {
  if (!/^creative_gate_\d+$/.test(schema))
    throw new Error("Unexpected test schema");
  await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.$disconnect();
}
