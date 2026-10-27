import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { config, sourceRoot, json, save } from "./common.mjs";
const c = await config();
const out = join(sourceRoot, "artifacts/operations-lab/background");
await mkdir(out, { recursive: true });
// Explicit allowlist only. Never export vaults, dumps, PM2 environments, raw
// financial snapshots, logs, reviewed identity documents or source fingerprints.
for (const [source, name] of [
  [".runtime/acceptance/background.json", "independence.json"],
  [".runtime/entitlement-proof.json", "entitlement.json"],
  [".runtime/daily-sq.md", "daily-sq.md"],
])
  await cp(join(c.data, source), join(out, name));
const { root, ...restore } = await json(
  join(c.data, ".runtime/last-restore.json"),
);
await save(join(out, "restore.json"), restore);
console.log("Allowlisted background acceptance evidence exported");
