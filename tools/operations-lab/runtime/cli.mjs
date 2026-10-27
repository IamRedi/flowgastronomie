import { mkdir, cp, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  sourceRoot,
  runtimeRoot,
  labEnv,
  config,
  json,
  save,
  run,
  pm2,
  processes,
  operator,
  ready,
  inside,
} from "./common.mjs";
const mode = process.argv[2],
  args = process.argv.slice(3);
function value(name) {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
}
const opt = (name) => args.includes(name);
if (mode === "prepare") {
  // Do not change the accepted controller/config beneath live processes.
  let existing;
  try {
    await access(join(runtimeRoot, "runtime.json"));
    existing = await config();
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (existing) {
    const pid = Number(
      await readFile(join(existing.pm2Home, "pm2.pid"), "utf8").catch(
        () => "0",
      ),
    );
    let alive = false;
    if (Number.isSafeInteger(pid) && pid > 0)
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {}
    if (
      alive &&
      (await processes(existing)).some(
        (p) => !["stopped", "errored"].includes(p.status),
      )
    )
      throw new Error(
        "STOP_BACKGROUND_RUNTIME_BEFORE_PREPARING_ANOTHER_REVISION",
      );
  }
  const revision = value("--revision");
  if (
    !revision ||
    !/^[a-f0-9]{40}$/.test(revision) ||
    (!opt("--approve-revision") && !opt("--acceptance-only"))
  )
    throw new Error(
      "Provide exact --revision plus explicit --approve-revision after review, or temporary --acceptance-only",
    );
  if (
    (
      await run(
        "git",
        ["status", "--porcelain", "--untracked-files=no"],
        sourceRoot,
        { capture: true },
      )
    ).trim()
  )
    throw new Error("Commit candidate code before pinning");
  const code = inside(runtimeRoot, join(runtimeRoot, "revisions", revision)),
    data = inside(runtimeRoot, join(runtimeRoot, "data"));
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  try {
    await access(join(code, ".git"));
  } catch {
    await run(
      "git",
      ["worktree", "add", "--detach", code, revision],
      sourceRoot,
    );
  }
  const env = labEnv({
    OPERATIONS_LAB_ENABLED: "true",
    NEXT_DIST_DIR: ".next-operations-runtime",
    OPERATIONS_LAB_BACKGROUND_WEB: "true",
  });
  await run("npm", ["ci"], code, { env });
  await run("npm", ["run", "lab:generate"], code, { env });
  await run(
    process.execPath,
    [
      createRequire(join(code, "apps/web/package.json")).resolve(
        "next/dist/bin/next",
      ),
      "build",
      join(code, "apps/web"),
    ],
    join(code, "apps/web"),
    { env: { ...env, NODE_ENV: "production" } },
  );
  await run("git", ["restore", "--", "apps/web/next-env.d.ts"], code);
  await mkdir(data, { recursive: true, mode: 0o700 });
  await mkdir(join(data, "tools/operations-lab"), { recursive: true });
  await cp(
    join(code, "compose.operations-lab.yaml"),
    join(data, "compose.operations-lab.yaml"),
  );
  await cp(
    join(code, "tools/operations-lab/init.sql"),
    join(data, "tools/operations-lab/init.sql"),
  );
  try {
    await access(join(data, ".operations-lab"));
  } catch {
    await cp(
      join(sourceRoot, ".operations-lab"),
      join(data, ".operations-lab"),
      { recursive: true, errorOnExist: true, force: false },
    );
    await cp(
      join(sourceRoot, "artifacts/operations-lab"),
      join(data, "artifacts/operations-lab"),
      { recursive: true, errorOnExist: true, force: false },
    );
  }
  const c = {
    version: 1,
    marker: "RFO_PINNED_LOCAL_RUNTIME_V1",
    revision,
    code,
    data,
    pm2Home: join(data, ".pm2"),
    approvedAt: new Date().toISOString(),
    approval: opt("--acceptance-only")
      ? "TEMPORARY_ACCEPTANCE_ONLY"
      : "EXPLICIT_OPERATOR_REVISION_APPROVAL",
    sourceMain: (
      await run("git", ["rev-parse", "origin/main"], sourceRoot, {
        capture: true,
      })
    ).trim(),
  };
  await save(join(runtimeRoot, "runtime.json"), c);
  await save(join(data, ".runtime/config.json"), c);
  console.log(
    "Pinned isolated runtime prepared: " + revision + " (not started)",
  );
} else {
  const c = await config();
  if (sourceRoot !== c.code && mode !== "prepare") {
    await run(
      process.execPath,
      [join(c.code, "tools/operations-lab/runtime/cli.mjs"), mode, ...args],
      c.data,
      { env: labEnv({ LAB_RUNTIME_ROOT: runtimeRoot }) },
    );
    process.exit(0);
  }
  if (
    (
      await run("git", ["rev-parse", "HEAD"], c.code, { capture: true })
    ).trim() !== c.revision ||
    (
      await run(
        "git",
        ["status", "--porcelain", "--untracked-files=no"],
        c.code,
        { capture: true },
      )
    ).trim()
  )
    throw new Error("PINNED_RUNTIME_CODE_CHANGED");
  if (mode === "start") {
    if (c.approval === "TEMPORARY_ACCEPTANCE_ONLY" && !opt("--acceptance-only"))
      throw new Error(
        "Acceptance candidate is not approved for permanent activation",
      );
    for (const port of [4400, 3400]) {
      try {
        await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (!(await processes(c)).some((p) => p.status === "online"))
          throw new Error("UNMANAGED_LAB_PORT_IN_USE");
      } catch (e) {
        if (e.message === "UNMANAGED_LAB_PORT_IN_USE") throw e;
      }
    }
    await run(
      "docker",
      [
        "compose",
        "-f",
        join(c.code, "compose.operations-lab.yaml"),
        "up",
        "-d",
        "--wait",
      ],
      c.code,
    );
    await run(
      process.execPath,
      [
        "--import",
        pathToFileURL(join(c.code, "node_modules/tsx/dist/loader.mjs")).href,
        join(c.code, "apps/api/src/operations-lab/continuity-command.ts"),
        "init",
        c.code,
      ],
      c.data,
    );
    // Renew existing opt-ins before the worker can encounter an expired trial.
    // This never opts in a venue unless the operator provided the explicit flag.
    await run(
      process.execPath,
      [
        "--import",
        pathToFileURL(join(c.code, "node_modules/tsx/dist/loader.mjs")).href,
        join(c.code, "apps/api/src/operations-lab/continuity-command.ts"),
        opt("--enable-test-entitlements") ? "enable" : "renew",
        ...(opt("--enable-test-entitlements")
          ? ["Explicit operator opt-in for synthetic local laboratory"]
          : []),
      ],
      c.data,
    );
    const common = {
      instances: 1,
      exec_mode: "fork",
      watch: false,
      merge_logs: true,
      autorestart: true,
      min_uptime: 30000,
      max_restarts: 5,
      exp_backoff_restart_delay: 1000,
      kill_timeout: 30000,
      shutdown_with_message: true,
      cwd: c.data,
      interpreter: process.execPath,
      pmx: false,
      env: labEnv({
        LAB_RUNTIME_ROOT: runtimeRoot,
        OPERATIONS_LAB_SOURCE_ROOT: c.code,
        NEXT_DIST_DIR: ".next-operations-runtime",
        OPERATIONS_LAB_BACKGROUND_WEB: "true",
        LAB_RUNTIME_CONFIG: join(c.data, ".runtime/config.json"),
        PM2_HOME: c.pm2Home,
      }),
    };
    const ts = pathToFileURL(
      join(c.code, "node_modules/tsx/dist/loader.mjs"),
    ).href;
    const apps = ["api", "worker", "monitor"].map((kind) => ({
      ...common,
      name: "rflow-lab-" + kind,
      script: join(
        c.code,
        "apps/api/src/operations-lab/" +
          {
            api: "server",
            worker: "runtime-worker",
            monitor: "continuity-monitor",
          }[kind] +
          ".ts",
      ),
      node_args: ["--import", ts],
      out_file: join(c.data, ".runtime/logs/" + kind + ".out.log"),
      error_file: join(c.data, ".runtime/logs/" + kind + ".error.log"),
    }));
    apps.push({
      ...common,
      name: "rflow-lab-web",
      script: join(c.code, "tools/operations-lab/runtime/web.mjs"),
      node_args: [],
      env: { ...common.env, NODE_ENV: "production" },
      out_file: join(c.data, ".runtime/logs/web.out.log"),
      error_file: join(c.data, ".runtime/logs/web.error.log"),
    });
    await mkdir(join(c.data, ".runtime/logs"), {
      recursive: true,
      mode: 0o700,
    });
    await save(join(c.data, "ecosystem.config.json"), { apps });
    await pm2(c, [
      "start",
      join(c.data, "ecosystem.config.json"),
      "--only",
      "rflow-lab-api,rflow-lab-web",
    ]);
    await ready("http://127.0.0.1:4400/lab/identity");
    await ready("http://127.0.0.1:3400/en/lab");
    await pm2(c, [
      "start",
      join(c.data, "ecosystem.config.json"),
      "--only",
      "rflow-lab-worker,rflow-lab-monitor",
    ]);
    if (!opt("--services-only")) {
      for (const v of (await operator(c, "/status")).venues) {
        if (v.mode !== "STOPPED") continue; // Preserve PAUSED/NEEDS_REVIEW checkpoints.
        let version = v.version;
        if (v.config.mode === "FUNCTIONAL_WINDOW") {
          await operator(c, "/config", {
            profile: v.profile,
            expectedVersion: version,
            config: {
              ...v.config,
              mode: "WALL_CLOCK",
              cap: 200,
              graceSeconds: 300,
              weekendBusy: true,
            },
          });
          version = (await operator(c, "/status")).venues.find(
            (x) => x.profile === v.profile,
          ).version;
        }
        await operator(c, "/control", {
          profile: v.profile,
          expectedVersion: version,
          mode: "RUNNING",
        });
      }
    }
    console.log(
      "LAB background processes are healthy; launcher is exiting. Traffic controls remain persisted.",
    );
  } else if (mode === "stop") {
    const state = await operator(c, "/status").catch(() => null);
    if (
      !state &&
      (await processes(c)).some(
        (p) => p.name === "rflow-lab-worker" && p.status === "online",
      )
    )
      throw new Error(
        "LAB_STOP_REQUIRES_API_FOR_DURABLE_PAUSE: recover the managed API, then stop again",
      );
    if (state)
      for (const v of state.venues)
        if (["RUNNING", "STOP_AFTER_DAY"].includes(v.mode))
          await operator(c, "/control", {
            profile: v.profile,
            mode: "PAUSED",
            expectedVersion: v.version,
          });
    if (state) {
      const until = Date.now() + 180000;
      while (
        (await operator(c, "/status")).venues.some((v) => v.counts.inFlight > 0)
      ) {
        if (Date.now() > until)
          throw new Error("LAB_STOP_WAITING_FOR_IN_FLIGHT_ACTION_REVIEW");
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    await pm2(c, ["stop", "rflow-lab-worker"]);
    await pm2(c, ["stop", "rflow-lab-monitor"]);
    await pm2(c, ["stop", "rflow-lab-web"]);
    await pm2(c, ["stop", "rflow-lab-api"]);
    console.log(
      "LAB stopped safely; database, cash/shift state and PDFs retained.",
    );
  } else if (mode === "status") {
    const procs = await processes(c),
      report = await json(join(c.data, ".runtime/health.json")).catch(
        () => null,
      );
    console.log(
      JSON.stringify(
        { revision: c.revision, processes: procs, health: report },
        null,
        2,
      ),
    );
  } else if (mode === "restart") {
    const service = value("--service");
    if (!["api", "web", "worker", "monitor"].includes(service))
      throw new Error("Select an owned LAB service");
    await pm2(c, ["restart", "rflow-lab-" + service]);
  } else if (mode === "terminate-test-daemon") {
    if (c.approval !== "TEMPORARY_ACCEPTANCE_ONLY")
      throw new Error(
        "Only the temporary acceptance daemon may be terminated here",
      );
    await pm2(c, ["kill"]);
  } else throw new Error("Use prepare/start/stop/status/restart");
}
