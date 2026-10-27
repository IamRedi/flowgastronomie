import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { spawnCommandSync } from "../operations/process-command.mjs";
const require = createRequire(import.meta.url),
  { PrismaClient } = require("@prisma/client");
const source = new URL(process.env.DATABASE_URL ?? "");
if (
  !["localhost", "127.0.0.1"].includes(source.hostname) ||
  !/^postgres(ql)?:$/.test(source.protocol)
)
  throw new Error("Local PostgreSQL required");
const schema = "workforce_browser_" + Date.now();
source.searchParams.set("schema", schema);
const env = {
  ...process.env,
  DATABASE_URL: source.toString(),
  WORKFORCE_BROWSER_GATE: "true",
  WORKFORCE_DOCUMENT_KEY: randomBytes(32).toString("base64"),
  TRANSACTIONAL_EMAIL_PROVIDER: "disabled",
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
  if (migrate.status !== 0) throw new Error("Migration failed");
  const test = spawnCommandSync(
    process.execPath,
    [
      require.resolve("@playwright/test/cli"),
      "test",
      "--config",
      "playwright.workforce.config.ts",
      ...process.argv.slice(2),
    ],
    { env, stdio: "inherit" },
  );
  process.exitCode = test.status ?? 1;
} finally {
  if (!/^workforce_browser_\d+$/.test(schema))
    throw new Error("Unexpected test schema");
  await client.$executeRawUnsafe(
    'DROP SCHEMA IF EXISTS "' + schema + '" CASCADE',
  );
  await client.$disconnect();
}
