import { createRequire } from "node:module";
import { spawnCommandSync } from "../operations/process-command.mjs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const source = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(source.hostname))
  throw new Error("Setup acceptance requires local PostgreSQL");
if (process.argv.includes("--local"))
  throw new Error(
    "Use isolated synthetic acceptance; precreated local businesses are retired",
  );
const schema = `setup_browser_${Date.now()}`;
source.searchParams.set("schema", schema);
const env = {
  ...process.env,
  DATABASE_URL: source.toString(),
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
  if (migration.status !== 0) throw new Error("Setup migrations failed");
  const result = spawnCommandSync(
    process.execPath,
    [
      require.resolve("@playwright/test/cli"),
      "test",
      "--config",
      "playwright.setup.config.ts",
      ...(process.argv.includes("--media")
        ? ["media.spec.ts"]
        : process.argv.includes("--premium")
          ? ["premium-owner.spec.ts"]
          : []),
    ],
    { env, stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
} finally {
  if (!/^setup_browser_\d+$/.test(schema))
    throw new Error("Unexpected test schema");
  await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.$disconnect();
}
