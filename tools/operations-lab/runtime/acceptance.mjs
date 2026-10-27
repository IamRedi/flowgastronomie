import { spawn } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  config,
  runtimeRoot,
  sourceRoot,
  labEnv,
  run,
  pm2,
  processes,
  operator,
  ready,
  save,
} from "./common.mjs";
import {
  pauseReadyVenues,
  changeControlWithRecovery,
  waitForReadCondition as waitFor,
} from "../runtime-checkpoints.mjs";
import { spawnCommandSync } from "../../../tests/operations/process-command.mjs";
const c = await config();
if (c.approval !== "TEMPORARY_ACCEPTANCE_ONLY")
  throw new Error("Acceptance uses only a temporary pinned candidate");
const env = labEnv({ LAB_RUNTIME_ROOT: runtimeRoot }),
  tsx = pathToFileURL(join(c.code, "node_modules/tsx/dist/loader.mjs")).href;
const startedAt = new Date(),
  proofRoot = join(c.data, ".runtime/acceptance");
await mkdir(proofRoot, { recursive: true });
async function probe(mode, args = []) {
  await run(
    process.execPath,
    [
      "--import",
      tsx,
      join(c.code, "apps/api/src/operations-lab/continuity-probe.ts"),
      mode,
      ...args,
    ],
    c.data,
    { env },
  );
}
async function oldProbe(mode) {
  await run(
    process.execPath,
    [
      "--import",
      tsx,
      join(c.code, "apps/api/src/operations-lab/runtime-acceptance.ts"),
      mode,
    ],
    c.data,
    { env },
  );
}
async function change(profile, mode) {
  await changeControlWithRecovery(profile, mode, (path, body) =>
    operator(c, path, body),
  );
}
async function expectControllerRefusal(args, reason) {
  const child = spawn(
    process.execPath,
    [join(sourceRoot, "tools/operations-lab/runtime/cli.mjs"), ...args],
    {
      cwd: sourceRoot,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (b) => {
    output += b;
  });
  child.stderr.on("data", (b) => {
    output += b;
  });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (code === 0 || !output.includes(reason))
    throw new Error("BACKGROUND_GUARD_NOT_ENFORCED: " + reason);
}
let hoursChanged = false,
  finalProof;
try {
  const launcher = spawn(
    process.execPath,
    [
      join(sourceRoot, "tools/operations-lab/runtime/cli.mjs"),
      "start",
      "--acceptance-only",
      "--services-only",
      "--enable-test-entitlements",
    ],
    { cwd: sourceRoot, env, windowsHide: true, stdio: "inherit" },
  );
  const launcherPid = launcher.pid;
  await new Promise((resolve, reject) =>
    launcher.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("BACKGROUND_LAUNCHER_FAILED")),
    ),
  );
  await ready("http://127.0.0.1:4400/lab/identity");
  await waitFor(async () => {
    const ps = await processes(c);
    return (
      ps.length === 4 &&
      ps.every((p) => p.status === "online" && p.pid !== launcherPid)
    );
  });
  const initial = await processes(c);
  await expectControllerRefusal(
    ["prepare", "--revision", c.revision, "--acceptance-only"],
    "STOP_BACKGROUND_RUNTIME_BEFORE_PREPARING_ANOTHER_REVISION",
  );
  if (
    (await fetch("http://127.0.0.1:4400/lab/operator/continuity")).status !==
    401
  )
    throw new Error("CONTINUITY_MONITOR_EXPOSED_WITHOUT_OPERATOR_AUTH");
  await waitFor(
    async () => (await operator(c, "/continuity")).monitor?.database === true,
  );
  await probe("entitlement-proof");
  hoursChanged = true;
  await probe("hours-setup");
  for (const v of (await operator(c, "/status")).venues) {
    if (v.mode !== "STOPPED")
      throw new Error("EXISTING_DAY_MUST_BE_REVIEWED_BEFORE_ACCEPTANCE");
    await operator(c, "/config", {
      profile: v.profile,
      expectedVersion: v.version,
      config: {
        ...v.config,
        mode: "FUNCTIONAL_WINDOW",
        seed: 4601,
        cap: 18,
        windowSeconds: 90,
        graceSeconds: 3600,
        weekendBusy: false,
      },
    });
    await change(v.profile, "RUNNING");
  }
  await waitFor(async () =>
    pauseReadyVenues(
      (await operator(c, "/status")).venues,
      (v) => v.counts.own >= 3,
      (p) => change(p, "PAUSED"),
    ),
  );
  await waitFor(async () =>
    (await operator(c, "/status")).venues.every((v) => v.counts.inFlight === 0),
  );
  await probe("financial-snapshot", [join(proofRoot, "before-restart.json")]);
  const api = (await processes(c)).find((p) => p.name === "rflow-lab-api");
  if (process.platform === "win32") {
    const r = spawnCommandSync(
      "taskkill",
      ["/PID", String(api.pid), "/T", "/F"],
      { stdio: "ignore" },
    );
    if (r.status !== 0) throw new Error("OWNED_API_CRASH_INJECTION_FAILED");
  } else process.kill(api.pid, "SIGKILL");
  await waitFor(async () => {
    const p = (await processes(c)).find((p) => p.name === "rflow-lab-api");
    return (
      p.pid !== api.pid && p.status === "online" && p.restarts > api.restarts
    );
  });
  await ready("http://127.0.0.1:4400/lab/identity");
  await probe("financial-snapshot", [join(proofRoot, "after-restart.json")]);
  if (
    (await readFile(join(proofRoot, "before-restart.json"), "utf8")) !==
    (await readFile(join(proofRoot, "after-restart.json"), "utf8"))
  )
    throw new Error("FINANCIAL_IDENTITIES_CHANGED_DURING_CRASH");
  await pm2(c, ["stop", "rflow-lab-api"]);
  await expectControllerRefusal(
    ["stop"],
    "LAB_STOP_REQUIRES_API_FOR_DURABLE_PAUSE",
  );
  await pm2(c, ["restart", "rflow-lab-api"]);
  await ready("http://127.0.0.1:4400/lab/identity");
  await oldProbe("probe");
  for (const p of ["DE", "AL"]) await change(p, "RUNNING");
  await pm2(c, ["restart", "rflow-lab-worker"]);
  for (const p of ["DE", "AL"]) await change(p, "STOP_AFTER_DAY");
  await waitFor(
    async () =>
      (await operator(c, "/status")).venues.every(
        (v) =>
          v.mode === "STOPPED" &&
          v.report &&
          !v.report.coverageIncomplete &&
          !v.report.discrepancies.length,
      ),
    600000,
  );
  await oldProbe("final");
  const final = await operator(c, "/status"),
    finalProcesses = await processes(c);
  const sentinel = join(
    sourceRoot,
    "artifacts/runtime-development-sentinel.txt",
  );
  await writeFile(
    sentinel,
    "Development edits must not change pinned running services",
  );
  await new Promise((r) => setTimeout(r, 1500));
  const stable = await processes(c);
  if (
    stable.some(
      (p) => p.pid !== finalProcesses.find((x) => x.name === p.name).pid,
    )
  )
    throw new Error("DEVELOPMENT_EDIT_RESTARTED_PINNED_SERVICE");
  finalProof = {
    version: 1,
    status: "passed",
    revision: c.revision,
    launcherPid,
    launcherExited: true,
    independentProcessPids: initial.map((p) => ({ name: p.name, pid: p.pid })),
    apiCrashAutoRestart: true,
    workerManagedRestart: true,
    financialIdentitiesPreserved: true,
    operatorAuthenticationVerified: true,
    liveRevisionChangeDenied: true,
    stopWithoutDurablePauseDenied: true,
    pinnedCodeUnaffectedByDevelopment: true,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    actualElapsedSeconds: (Date.now() - startedAt.getTime()) / 1000,
    venues: final.venues.map((v) => ({
      profile: v.profile,
      runId: v.runId,
      counts: v.report.counts,
      completedBrowser: v.report.completedBrowser,
      discrepancies: v.report.discrepancies,
      cash: v.report.cash,
    })),
    multiDayUptimeProven: false,
  };
} finally {
  let cleanupError;
  if (hoursChanged)
    try {
      await probe("hours-restore");
    } catch (e) {
      cleanupError = e;
    }
  await run(
    process.execPath,
    [join(sourceRoot, "tools/operations-lab/runtime/cli.mjs"), "stop"],
    sourceRoot,
    { env },
  );
  if (!finalProof)
    await run(
      process.execPath,
      [
        join(sourceRoot, "tools/operations-lab/runtime/cli.mjs"),
        "terminate-test-daemon",
      ],
      sourceRoot,
      { env },
    );
  if (cleanupError) throw cleanupError;
}
await save(join(proofRoot, "background.json"), finalProof);
try {
  await run(
    process.execPath,
    [join(sourceRoot, "tools/operations-lab/runtime/backup.mjs")],
    sourceRoot,
    { env },
  );
  await run(
    process.execPath,
    [join(sourceRoot, "tools/operations-lab/runtime/restore.mjs")],
    sourceRoot,
    { env },
  );
} finally {
  await run(
    process.execPath,
    [
      join(sourceRoot, "tools/operations-lab/runtime/cli.mjs"),
      "terminate-test-daemon",
    ],
    sourceRoot,
    { env },
  );
}
await run(
  process.execPath,
  [join(sourceRoot, "tools/operations-lab/runtime/evidence.mjs")],
  sourceRoot,
  { env },
);
console.log(
  "Bounded background independence, entitlement and restore acceptance passed; no permanent service left running",
);
