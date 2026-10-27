import { openSync, closeSync } from "node:fs";
import { mkdir, cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawnCommandSync } from "../../../tests/operations/process-command.mjs";
import {
  config,
  runtimeRoot,
  sourceRoot,
  labEnv,
  run,
  save,
  inside,
  processes,
} from "./common.mjs";
const c = await config(),
  env = labEnv({ LAB_RUNTIME_ROOT: runtimeRoot });
await run(
  process.execPath,
  [join(c.code, "tools/operations-lab/runtime/cli.mjs"), "stop"],
  c.data,
  { env },
);
if ((await processes(c)).some((p) => p.status === "online"))
  throw new Error("LAB_BACKUP_REQUIRES_STOPPED_PROCESSES");
for (const port of [4400, 3400]) {
  try {
    await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    throw new Error("LAB_BACKUP_SERVICE_STILL_REACHABLE");
  } catch (e) {
    if (e.message === "LAB_BACKUP_SERVICE_STILL_REACHABLE") throw e;
  }
}
const root = inside(
  runtimeRoot,
  join(
    runtimeRoot,
    "backups",
    new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-"),
  ),
);
await mkdir(root, { recursive: true, mode: 0o700 });
const tsx = pathToFileURL(
  join(c.code, "node_modules/tsx/dist/loader.mjs"),
).href;
await run(
  process.execPath,
  [
    "--import",
    tsx,
    join(c.code, "apps/api/src/operations-lab/continuity-snapshot.ts"),
    "source",
    join(root, "source.json"),
  ],
  c.data,
  { env },
);
const fd = openSync(join(root, "database.dump"), "wx", 0o600);
try {
  const r = spawnCommandSync(
    "docker",
    [
      "compose",
      "-f",
      join(c.code, "compose.operations-lab.yaml"),
      "exec",
      "-T",
      "postgres",
      "pg_dump",
      "-U",
      "operations_lab",
      "-d",
      "restaurantflow_operations_lab",
      "-Fc",
    ],
    { stdio: ["ignore", fd, "inherit"] },
  );
  if (r.status !== 0) throw new Error("LAB_DUMP_FAILED");
} finally {
  closeSync(fd);
}
await cp(join(c.data, ".operations-lab"), join(root, "private"), {
  recursive: true,
});
await cp(
  join(c.data, "artifacts/operations-lab/receipts"),
  join(root, "receipts"),
  { recursive: true },
);
await cp(
  join(c.data, "artifacts/operations-lab/normal-day"),
  join(root, "reports"),
  { recursive: true },
);
await cp(
  join(c.data, "artifacts/operations-lab/runtime"),
  join(root, "runtime-reports"),
  { recursive: true },
);
await run(
  process.execPath,
  [
    "--import",
    tsx,
    join(c.code, "apps/api/src/operations-lab/continuity-snapshot.ts"),
    "source",
    join(root, "after.json"),
  ],
  c.data,
  { env },
);
if (
  (await readFile(join(root, "source.json"), "utf8")) !==
  (await readFile(join(root, "after.json"), "utf8"))
)
  throw new Error("SOURCE_CHANGED_DURING_QUIESCENT_BACKUP");
const hash = createHash("sha256")
  .update(await readFile(join(root, "database.dump")))
  .digest("hex");
const m = {
  version: 1,
  createdAt: new Date().toISOString(),
  revision: c.revision,
  databaseHash: hash,
  manifest: root,
  consistency:
    "All managed writers stopped after durable pause/drain; open registers/attendance are preserved, not fabricated closes",
  sourceFile: "source.json",
};
await save(join(root, "manifest.json"), m);
await save(join(c.data, ".runtime/last-backup.json"), m);
console.log("Verified paused-window backup: " + root);
if (process.argv.includes("--resume"))
  await run(
    process.execPath,
    [
      join(c.code, "tools/operations-lab/runtime/cli.mjs"),
      "start",
      ...(c.approval === "TEMPORARY_ACCEPTANCE_ONLY"
        ? ["--acceptance-only"]
        : []),
      "--services-only",
    ],
    c.data,
    { env },
  );
