import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, cp } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnCommandSync } from "../../../tests/operations/process-command.mjs";
import {
  config,
  runtimeRoot,
  inside,
  json,
  labEnv,
  run,
  processes,
  save,
} from "./common.mjs";
const c = await config(),
  backup = resolve(
    process.argv[2] ??
      (await json(join(c.data, ".runtime/last-backup.json"))).manifest,
  );
inside(join(runtimeRoot, "backups"), backup);
if ((await processes(c)).some((p) => p.status === "online"))
  throw new Error("STOP_MANAGED_WRITERS_BEFORE_RESTORE_ACCEPTANCE");
const manifest = await json(join(backup, "manifest.json"));
if (
  createHash("sha256")
    .update(await readFile(join(backup, "database.dump")))
    .digest("hex") !== manifest.databaseHash
)
  throw new Error("RESTORE_DUMP_HASH_MISMATCH");
const root = inside(
    runtimeRoot,
    join(runtimeRoot, "restore-tests", randomUUID()),
  ),
  project =
    "rflow-lab-restore-" +
    root.split(/[\\/]/).at(-1).replaceAll("-", "").slice(0, 12);
await mkdir(join(root, "data/artifacts/operations-lab"), {
  recursive: true,
  mode: 0o700,
});
const compose = join(root, "compose.json"),
  // A CI parent's COMPOSE_PROJECT_NAME overrides the file's top-level name.
  // Pin every target operation so restore cannot recreate the source service.
  composeArgs = ["compose", "--project-name", project, "-f", compose];
await save(compose, {
  name: project,
  services: {
    postgres: {
      image: "postgres:17-alpine",
      cpus: "1.0",
      mem_limit: "1g",
      memswap_limit: "1g",
      pids_limit: 256,
      environment: {
        POSTGRES_DB: "restaurantflow_operations_lab_restore",
        POSTGRES_USER: "operations_lab_restore",
        POSTGRES_PASSWORD: "operations_lab_restore_local_only",
      },
      ports: ["127.0.0.1:55441:5432"],
      volumes: ["restore-postgres:/var/lib/postgresql/data"],
      healthcheck: {
        test: [
          "CMD-SHELL",
          "pg_isready -U operations_lab_restore -d restaurantflow_operations_lab_restore",
        ],
        interval: "2s",
        timeout: "2s",
        retries: 30,
      },
    },
  },
  volumes: { "restore-postgres": {} },
});
const planResult = spawnCommandSync(
  "docker",
  [...composeArgs, "config", "--format", "json"],
  { cwd: root, env: labEnv(), encoding: "utf8" },
);
if (planResult.status !== 0) throw new Error("DISPOSABLE_RESTORE_PLAN_FAILED");
const targetPlan = JSON.parse(planResult.stdout);
if (
  targetPlan.name !== project ||
  targetPlan.name === process.env.COMPOSE_PROJECT_NAME
)
  throw new Error("DISPOSABLE_RESTORE_PROJECT_ISOLATION_REQUIRED");
const tsx = pathToFileURL(
    join(c.code, "node_modules/tsx/dist/loader.mjs"),
  ).href,
  srcEnv = labEnv({ LAB_RUNTIME_ROOT: runtimeRoot });
await run(
  process.execPath,
  [
    "--import",
    tsx,
    join(c.code, "apps/api/src/operations-lab/continuity-snapshot.ts"),
    "source",
    join(root, "source-before.json"),
  ],
  c.data,
  { env: srcEnv },
);
try {
  await run("docker", [...composeArgs, "up", "-d", "--wait"], root);
  const fd = openSync(join(backup, "database.dump"), "r");
  try {
    const r = spawnCommandSync(
      "docker",
      [
        ...composeArgs,
        "exec",
        "-T",
        "postgres",
        "pg_restore",
        "-U",
        "operations_lab_restore",
        "-d",
        "restaurantflow_operations_lab_restore",
        "--no-owner",
        "--no-acl",
      ],
      { stdio: [fd, "ignore", "inherit"] },
    );
    if (r.status !== 0) throw new Error("DISPOSABLE_RESTORE_FAILED");
  } finally {
    closeSync(fd);
  }
  await cp(join(backup, "private"), join(root, "data/.operations-lab"), {
    recursive: true,
  });
  await cp(
    join(backup, "receipts"),
    join(root, "data/artifacts/operations-lab/receipts"),
    { recursive: true },
  );
  await cp(
    join(backup, "reports"),
    join(root, "data/artifacts/operations-lab/normal-day"),
    { recursive: true },
  );
  await cp(
    join(backup, "runtime-reports"),
    join(root, "data/artifacts/operations-lab/runtime"),
    { recursive: true },
  );
  const target =
    "postgresql://operations_lab_restore:operations_lab_restore_local_only@127.0.0.1:55441/restaurantflow_operations_lab_restore?schema=public";
  await run(
    process.execPath,
    [
      "--import",
      tsx,
      join(c.code, "apps/api/src/operations-lab/restore-verify.ts"),
      backup,
      join(root, "acceptance.json"),
    ],
    join(root, "data"),
    {
      env: {
        ...srcEnv,
        DATABASE_URL: target,
        LAB_DISPOSABLE_RESTORE: "true",
        LAB_RESTORE_REVIEW: join(root, "reviewed-identity.json"),
      },
    },
  );
  await run(
    process.execPath,
    [
      "--import",
      tsx,
      join(c.code, "apps/api/src/operations-lab/continuity-snapshot.ts"),
      "source",
      join(root, "source-after.json"),
    ],
    c.data,
    { env: srcEnv },
  );
  if (
    (await readFile(join(root, "source-before.json"), "utf8")) !==
    (await readFile(join(root, "source-after.json"), "utf8"))
  )
    throw new Error("PRIMARY_SOURCE_CHANGED_DURING_RESTORE");
  const proof = await json(join(root, "acceptance.json"));
  proof.sourceUnchanged = true;
  proof.originalVolumeUntouched = true;
  proof.disposableProject = project;
  await save(join(root, "acceptance.json"), proof);
  console.log(JSON.stringify(proof, null, 2));
  await save(join(c.data, ".runtime/last-restore.json"), { root, ...proof });
} finally {
  await run("docker", [...composeArgs, "stop"], root);
}
