import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawnCommandSync } from "../operations/process-command.mjs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const source = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(source.hostname))
  throw new Error("Premium gates require local PostgreSQL");
const schema = `premium_gate_${Date.now()}`;
source.searchParams.set("schema", schema);
const env = {
  ...process.env,
  DATABASE_URL: source.toString(),
  PREMIUM_DB_GATE: "true",
  FOUNDATION_DB_GATE: "true",
  WEBSITE_COPY_AI_ENABLED: "false",
  CREATIVE_OPENAI_API_KEY: "",
  MENU_IMPORT_PROVIDER: "disabled",
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
  if (migrate.status !== 0) throw new Error("Premium migrations failed");
  for (const [cwd, file] of [
    ["packages/database", "src/premium-templates.integration.test.ts"],
    ["packages/database", "src/foundation-bf2.integration.test.ts"],
    ["apps/api", "src/website-proposals.integration.test.ts"],
  ]) {
    const test = spawnCommandSync(
      process.execPath,
      [
        join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"),
        "run",
        file,
      ],
      { cwd, env, stdio: "inherit" },
    );
    if (test.status !== 0) throw new Error(`Premium gate failed: ${file}`);
  }
} finally {
  if (!/^premium_gate_\d+$/.test(schema)) throw new Error("Unexpected schema");
  await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.$disconnect();
}
