import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnCommandSync } from "../operations/process-command.mjs";
const require = createRequire(import.meta.url);
function run(command, args, options = {}) {
  const result = spawnCommandSync(command, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0)
    throw new Error(`Import acceptance failed: ${command} ${args.join(" ")}`);
  return result;
}
// The optional production renderer is mandatory in acceptance. Build only the
// reviewed worker and use its immutable local image ID with --pull=never.
run("docker", [
  "build",
  "--quiet",
  "-t",
  "flow-import-renderer:acceptance",
  "tools/import-renderer",
]);
const image = run(
  "docker",
  [
    "image",
    "inspect",
    "flow-import-renderer:acceptance",
    "--format",
    "{{.Id}}",
  ],
  { encoding: "utf8", stdio: "pipe" },
).stdout.trim();
if (!/^sha256:[a-f0-9]{64}$/.test(image))
  throw new Error("Invalid renderer image identity");
const env = {
  ...process.env,
  BUSINESS_IMPORT_RENDERER_IMAGE: image,
  BUSINESS_IMPORT_ALLOW_PAID_AI: "false",
  MENU_IMPORT_PROVIDER: "disabled",
};
run(
  process.execPath,
  [
    join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"),
    "run",
    "src/business-import-renderer.test.ts",
  ],
  { cwd: "apps/api", env },
);
// Browser/API fixtures inject network and OCR; only the dedicated renderer gate
// enables Docker so fixture business pages remain deterministic.
delete env.BUSINESS_IMPORT_RENDERER_IMAGE;
run(process.execPath, ["tests/setup/run-db-gate.mjs", "v2"], { env });
run(process.execPath, ["tests/import-v2/run-browser-gate.mjs"], { env });
mkdirSync("artifacts/import-v2", { recursive: true });
writeFileSync(
  "artifacts/import-v2/acceptance.json",
  JSON.stringify(
    {
      status: "passed",
      rendererImage: image,
      paidProviderCalls: 0,
      externalWebsiteRequests: 0,
      database: "isolated-local-schemas",
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);
