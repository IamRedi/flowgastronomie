import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { spawnCommandSync } from "../operations/process-command.mjs";
const require = createRequire(import.meta.url),
  { PrismaClient } = require("@prisma/client");
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !/^postgres(ql)?:$/.test(url.protocol) ||
  process.env.NODE_ENV === "production"
)
  throw new Error("Local nonproduction PostgreSQL required");
const schema = "workforce_wf4_" + Date.now();
url.searchParams.set("schema", schema);
const env = {
  ...process.env,
  DATABASE_URL: url.toString(),
  WORKFORCE_WF4_GATE: "true",
  WORKFORCE_DOCUMENT_KEY: randomBytes(32).toString("base64"),
  TRANSACTIONAL_EMAIL_PROVIDER: "disabled",
  WORKFORCE_PUSH_ENABLED: "false",
};
mkdirSync("artifacts/workforce-wf4", { recursive: true });
const client = new PrismaClient({ datasourceUrl: url.toString() });
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
  if (migrate.status !== 0) throw new Error("WF4 migration failed");
  const apiOnly = process.argv.includes("--api-only");
  const test = spawnCommandSync(
    process.execPath,
    apiOnly
      ? [require.resolve("tsx/cli"), "tests/workforce-wf4/run-simulation.ts"]
      : [
          require.resolve("@playwright/test/cli"),
          "test",
          "--config",
          "playwright.workforce-wf4.config.ts",
          "--reporter=dot,json",
          ...process.argv.slice(2),
        ],
    {
      env: {
        ...env,
        PLAYWRIGHT_JSON_OUTPUT_NAME:
          "artifacts/workforce-wf4/browser-report.json",
      },
      stdio: "inherit",
      timeout: 35 * 60 * 1000,
    },
  );
  process.exitCode = test.status ?? 1;
  const browserReport =
    !apiOnly && existsSync("artifacts/workforce-wf4/browser-report.json")
      ? JSON.parse(
          readFileSync("artifacts/workforce-wf4/browser-report.json", "utf8"),
        )
      : null;
  const manifest = existsSync("artifacts/workforce-wf4/manifest.json")
    ? JSON.parse(readFileSync("artifacts/workforce-wf4/manifest.json", "utf8"))
    : null;
  const complete =
    manifest?.runId === schema &&
    manifest?.status === "passed" &&
    (apiOnly ||
      (browserReport?.stats?.expected === 9 &&
        browserReport?.stats?.unexpected === 0 &&
        manifest?.browserPending === false));
  if (test.status === 0 && !complete) process.exitCode = 1;
  writeFileSync(
    "artifacts/workforce-wf4/acceptance.json",
    JSON.stringify(
      {
        schemaVersion: 1,
        runId: schema,
        revision: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        status: process.exitCode === 0 ? "passed" : "failed",
        scope: apiOnly ? "API-only" : "complete",
        browserTests: browserReport?.stats?.expected ?? 0,
        locales: !apiOnly ? ["sq", "de", "en", "it"] : [],
        widths: !apiOnly ? [360, 390, 768, 1440] : [],
        counts: manifest?.databaseTotals,
        daysPerBusiness: 31,
        primaryBusinesses: 2,
        discrepancies: manifest?.discrepancies,
        providerCalls: "controlled mocks only",
        remoteDatabaseChanges: false,
        deployment: false,
      },
      null,
      2,
    ),
  );
} finally {
  if (!/^workforce_wf4_\d+$/.test(schema))
    throw new Error("Invalid fixture schema");
  await client.$executeRawUnsafe(
    'DROP SCHEMA IF EXISTS "' + schema + '" CASCADE',
  );
  await client.$disconnect();
}
