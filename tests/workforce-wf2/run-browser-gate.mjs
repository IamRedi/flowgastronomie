import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
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
const schema = "workforce_wf2_browser_" + Date.now();
source.searchParams.set("schema", schema);
const env = {
  ...process.env,
  DATABASE_URL: source.toString(),
  WORKFORCE_WF2_BROWSER_GATE: "true",
  WORKFORCE_DOCUMENT_KEY: randomBytes(32).toString("base64"),
  TRANSACTIONAL_EMAIL_PROVIDER: "disabled",
};
const reportPath = resolve(
  "artifacts/workforce-wf2/browser-report-" + Date.now() + ".json",
);
mkdirSync("artifacts/workforce-wf2", { recursive: true });
env.PLAYWRIGHT_JSON_OUTPUT_NAME = reportPath;
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
      "playwright.workforce-wf2.config.ts",
      "--reporter=dot,json",
      ...process.argv.slice(2),
    ],
    { env, stdio: "inherit" },
  );
  process.exitCode = test.status ?? 1;
  const report = existsSync(reportPath)
    ? JSON.parse(readFileSync(reportPath, "utf8"))
    : null;
  const count = report?.stats?.expected ?? 0;
  const titles = (suite) => [
    ...(suite.specs ?? []).filter((s) => s.ok).map((s) => s.title),
    ...(suite.suites ?? []).flatMap(titles),
  ];
  const passedTitles = (report?.suites ?? []).flatMap(titles),
    locales = [
      ...new Set(
        passedTitles.flatMap((t) => {
          const m = t.match(/^(sq|de|en|it):/);
          return m ? [m[1]] : [];
        }),
      ),
    ];
  writeFileSync(
    "artifacts/workforce-wf2/acceptance.json",
    JSON.stringify(
      {
        status: test.status === 0 ? "passed" : "failed",
        passedTests: count,
        unexpectedTests: report?.stats?.unexpected ?? 0,
        scope: process.argv.length === 2 ? "complete" : "focused",
        locales,
        widths: passedTitles.some((t) => t.includes("real attendance day"))
          ? [360, 390, 768, 1440]
          : [],
        passedTitles,
        source: "real Next/React/Chromium → Fastify → PostgreSQL",
        providerDelivery: false,
      },
      null,
      2,
    ),
  );
} finally {
  if (!/^workforce_wf2_browser_\d+$/.test(schema))
    throw new Error("Unexpected test schema");
  await client.$executeRawUnsafe(
    'DROP SCHEMA IF EXISTS "' + schema + '" CASCADE',
  );
  await client.$disconnect();
}
