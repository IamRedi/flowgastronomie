import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawnCommandSync } from "../operations/process-command.mjs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const source = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(source.hostname))
  throw new Error("Smart Setup gates require local PostgreSQL");
const milestone = process.argv[2] ?? "si0";
if (!["si0", "si1", "si2", "v2"].includes(milestone))
  throw new Error("Unknown setup milestone");
const schema = `setup_gate_${Date.now()}`;
source.searchParams.set("schema", schema);
const env = {
  ...process.env,
  DATABASE_URL: source.toString(),
  SMART_SETUP_DB_GATE: "true",
  MENU_IMPORT_PROVIDER: "disabled",
};
const client = new PrismaClient({ datasourceUrl: source.toString() });
try {
  const migration = spawnCommandSync(
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
  if (migration.status !== 0) throw new Error("Setup gate migrations failed");
  const result = spawnCommandSync(
    process.execPath,
    [
      join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"),
      "run",
      milestone === "si0"
        ? "src/smart-setup.integration.test.ts"
        : milestone === "si1"
          ? "src/menu-import.integration.test.ts"
          : milestone === "si2"
            ? "src/setup-media.integration.test.ts"
            : "src/business-import.integration.test.ts",
      ...(milestone === "v2" ? ["src/self-service.integration.test.ts"] : []),
    ],
    {
      cwd: milestone === "si0" ? "packages/database" : "apps/api",
      env,
      stdio: "inherit",
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  if (!/^setup_gate_\d+$/.test(schema))
    throw new Error("Unexpected setup test schema");
  await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.$disconnect();
}
