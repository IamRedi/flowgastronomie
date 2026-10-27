import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { spawnCommandSync } from "./process-command.mjs";

// The gate loads .env through dotenv-cli, but a release build must never run
// with NODE_ENV=development inherited from it: Next prerendering is unstable
// in that mode and production hosting sets NODE_ENV explicitly (runbook).
delete process.env.NODE_ENV;

const outputArgument = process.argv.find((argument) =>
  argument.startsWith("--output="),
);
const output = resolve(
  outputArgument?.slice("--output=".length) ??
    "artifacts/release-evidence.json",
);

const gates = [
  [
    "migration-deploy",
    [
      "npx",
      "prisma",
      "migrate",
      "deploy",
      "--schema",
      "packages/database/prisma/schema.prisma",
    ],
  ],
  [
    "migration-status",
    [
      "npx",
      "prisma",
      "migrate",
      "status",
      "--schema",
      "packages/database/prisma/schema.prisma",
    ],
  ],
  ["integration", ["npm", "run", "test:integration"]],
  ["repository-check", ["npm", "run", "check"]],
  ["premium-templates", ["npm", "run", "test:premium"]],
  ["smart-business-import-v2", ["npm", "run", "test:import-v2"]],
  ["workforce-wf1", ["npm", "run", "test:workforce"]],
  ["workforce-wf2", ["npm", "run", "test:workforce:wf2"]],
  ["workforce-wf3", ["npm", "run", "test:workforce:wf3"]],
  ["workforce-wf4", ["npm", "run", "test:workforce:wf4"]],
  ["demo-seed", ["npm", "run", "db:seed"]],
  ["creative-studio", ["npm", "run", "test:creative"]],
  ["browser-smoke-and-quality", ["npm", "run", "test:e2e"]],
  ["sse-proxy", ["npm", "run", "test:sse-proxy"]],
  ["backup-restore", ["npm", "run", "test:backup-restore"]],
  [
    "static-security-and-production-dependency-audit",
    ["npm", "run", "test:security"],
  ],
];

const results = [];

for (const [name, [command, ...arguments_]] of gates) {
  const startedAt = new Date().toISOString();
  // Gates stream their output directly to this process's inherited stdout:
  // capturing through spawnSync pipes froze deterministically once a gate
  // produced roughly 80KB of output on CI runners, wedging the whole step.
  // Live output also makes gate progress visible while it happens.
  const result = spawnCommandSync(command, arguments_, {
    encoding: "utf8",
    stdio: "inherit",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.status === 0) {
    results.push({
      name,
      status: "passed",
      startedAt,
      finishedAt: new Date().toISOString(),
    });
  } else {
    results.push({
      name,
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode: result.status ?? 1,
      ...(result.error ? { spawnError: result.error.code } : {}),
    });
    break;
  }
}

const evidence = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  revision: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  node: process.version,
  releaseGate: results,
  status:
    results.length === gates.length &&
    results.every((gate) => gate.status === "passed")
      ? "passed"
      : "failed",
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence));
process.exitCode = evidence.status === "passed" ? 0 : 1;
