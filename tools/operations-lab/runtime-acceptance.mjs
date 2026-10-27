import { spawn } from "node:child_process";
import { mkdirSync, createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import {
  pauseReadyVenues,
  changeControlWithRecovery,
  waitForFaultCrashWithSiblingCheckpoint,
} from "./runtime-checkpoints.mjs";
mkdirSync("artifacts/operations-lab", { recursive: true });
const log = createWriteStream(
  "artifacts/operations-lab/runtime-supervisor.log",
  { flags: "a" },
);
const children = new Set();
function child(mode, args = []) {
  const c = spawn(
    process.execPath,
    ["tools/operations-lab/command.mjs", mode, ...args],
    {
      env: {
        ...process.env,
        NEXT_DIST_DIR: ".next-operations-lab",
        OPERATIONS_LAB_EXTERNAL_WEB: "true",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    },
  );
  c.stdout.pipe(log, { end: false });
  c.stderr.pipe(log, { end: false });
  children.add(c);
  c.on("exit", () => children.delete(c));
  return c;
}
async function stop(c) {
  if (!c || c.exitCode !== null) return;
  const done = new Promise((r) => c.once("exit", r));
  c.stdin.end("operations-lab-stop\n");
  await done;
}
async function ready(url) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("LAB2 supervised service unavailable");
}
let api, web, worker;
let password;
async function op(path, body) {
  password ??= JSON.parse(
    await readFile(".operations-lab/operator.json", "utf8"),
  ).secret;
  const r = await fetch("http://127.0.0.1:4400/lab/operator" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: "Bearer " + password,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok)
    throw new Error(
      "LAB2 operator request rejected: " +
        r.status +
        " " +
        (await r.json()).code,
    );
  return r.json();
}
async function waitFor(fn, ms = 300000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("LAB2 acceptance condition timed out");
}
async function change(profile, mode) {
  await changeControlWithRecovery(profile, mode, op);
}
try {
  for (const port of [4400, 3400]) {
    try {
      await fetch(`http://127.0.0.1:${port}/health`);
      throw new Error(
        "Stop existing owned lab processes before LAB2 acceptance",
      );
    } catch (e) {
      if (e.message.startsWith("Stop existing")) throw e;
    }
  }
  api = child("api");
  await ready("http://127.0.0.1:4400/lab/identity");
  web = child("web");
  await ready("http://127.0.0.1:3400/en/lab");
  const before = await op("/status"),
    seed = 2903;
  const resume = process.argv.includes("--resume-reviewed");
  if (
    !resume &&
    before.venues.every(
      (v) =>
        v.config.seed === seed &&
        v.config.mode === "FUNCTIONAL_WINDOW" &&
        v.mode === "STOPPED" &&
        v.report &&
        !v.report.coverageIncomplete &&
        !v.report.discrepancies.length,
    )
  ) {
    const verify = child("runtime-final");
    await new Promise((resolve, reject) =>
      verify.on("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error("LAB2 completed replay verification failed")),
      ),
    );
    console.log(
      "LAB2 completed acceptance rechecked without another operational run",
    );
  } else {
    for (const v of before.venues) {
      if (resume) {
        if (
          v.mode !== "PAUSED" ||
          v.config.seed !== seed ||
          v.config.mode !== "FUNCTIONAL_WINDOW"
        )
          throw new Error(
            "Reviewed resume must reference the same paused functional run",
          );
        await change(v.profile, "RUNNING");
        continue;
      }
      if (v.mode !== "STOPPED")
        throw new Error("LAB2 existing unfinished runtime requires review");
      await op("/config", {
        profile: v.profile,
        expectedVersion: v.version,
        config: {
          ...v.config,
          mode: "FUNCTIONAL_WINDOW",
          windowSeconds: 90,
          cap: 18,
          seed,
          weekendBusy: false,
          graceSeconds: 3600,
        },
      });
      await change(v.profile, "RUNNING");
    }
    const startedAt = resume
      ? new Date(before.venues[0].startedAt)
      : new Date();
    worker = child("worker", ["--fault-crash-after-payment"]);
    await waitForFaultCrashWithSiblingCheckpoint(
      () => worker.exitCode !== null,
      async () => (await op("/status")).venues,
      (profile) => change(profile, "PAUSED"),
      { wait: waitFor },
    );
    if (worker.exitCode === 0)
      throw new Error("Expected actual post-payment worker crash missing");
    await writeFile(
      "artifacts/operations-lab/runtime-crash.json",
      JSON.stringify(
        {
          version: 1,
          startedAt: startedAt.toISOString(),
          crashedAt: new Date().toISOString(),
          exitCode: worker.exitCode,
          truth:
            "Real worker process exit after canonical payment/action commit; no fake clock",
        },
        null,
        2,
      ),
    );
    worker = child("worker");
    await waitFor(async () => {
      const s = await op("/status");
      return pauseReadyVenues(
        s.venues,
        (v) => v.counts.own >= 3,
        (profile) => change(profile, "PAUSED"),
      );
    });
    // Durable pause must survive API and PostgreSQL restarts.
    await waitFor(async () =>
      (await op("/status")).venues.every((v) => v.counts.inFlight === 0),
    );
    await stop(worker);
    worker = undefined;
    const paused = await op("/status");
    await writeFile(
      "artifacts/operations-lab/runtime-paused.json",
      JSON.stringify(paused, null, 2),
    );
    await stop(api);
    api = child("api");
    await ready("http://127.0.0.1:4400/lab/identity");
    const afterApi = await op("/status");
    if (afterApi.venues.some((v) => v.mode !== "PAUSED"))
      throw new Error("Pause did not survive API restart");
    const probe = child("runtime-probe");
    await new Promise((resolve, reject) =>
      probe.on("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error("LAB2 PostgreSQL/browser probe failed")),
      ),
    );
    worker = child("worker");
    for (const p of ["DE", "AL"]) await change(p, "RUNNING");
    // Controlled UNKNOWN_RESULT on a subsequent receipt; explicit operator consent.
    await waitFor(async () => {
      const s = await op("/status");
      return pauseReadyVenues(
        s.venues,
        (v) => {
          const previous = new Set(
            before.venues
              .find((x) => x.profile === v.profile)
              .receipts.map((r) => r.id),
          );
          // First PAPER_OUT/retry must have reached real archive output before
          // injecting UNKNOWN_RESULT; an already committed unprinted P2 is not enough.
          return (
            v.receipts.filter((r) => !previous.has(r.id) && r.pdf).length >= 2
          );
        },
        (profile) => change(profile, "PAUSED"),
      );
    });
    await waitFor(async () =>
      (await op("/status")).venues.every((v) => v.counts.inFlight === 0),
    );
    await stop(worker);
    worker = undefined;
    const inject = child("runtime-unknown");
    await new Promise((resolve, reject) =>
      inject.on("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error("LAB2 UNKNOWN_RESULT probe failed")),
      ),
    );
    worker = child("worker");
    for (const p of ["DE", "AL"]) await change(p, "RUNNING");
    await waitFor(async () => {
      const s = await op("/status");
      const v = s.venues.find((v) => v.profile === "DE");
      return (
        v.mode === "NEEDS_REVIEW" &&
        v.printer.some((p) => p.error === "UNKNOWN_RESULT")
      );
    });
    const uncertain = (await op("/status")).venues
      .find((v) => v.profile === "DE")
      .printer.find((p) => p.error === "UNKNOWN_RESULT");
    await op("/print-review", {
      profile: "DE",
      jobId: uncertain.id,
      confirmPossibleDuplicate: true,
    });
    await change("DE", "PAUSED");
    await change("DE", "RUNNING");
    for (const p of ["DE", "AL"]) {
      const s = await op("/status"),
        v = s.venues.find((v) => v.profile === p);
      if (v.mode === "RUNNING") await change(p, "STOP_AFTER_DAY");
    }
    await waitFor(async () => {
      const s = await op("/status");
      return s.venues.every(
        (v) =>
          v.mode === "STOPPED" && v.report && !v.report.discrepancies.length,
      );
    }, 600000);
    await stop(worker);
    worker = undefined;
    const final = await op("/status");
    const verify = child("runtime-final");
    await new Promise((resolve, reject) =>
      verify.on("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error("LAB2 final source verification failed")),
      ),
    );
    await writeFile(
      "artifacts/operations-lab/runtime-acceptance.json",
      JSON.stringify(
        {
          version: 1,
          status: "passed",
          startedAt: startedAt.toISOString(),
          endedAt: new Date().toISOString(),
          actualElapsedSeconds: (Date.now() - startedAt.getTime()) / 1000,
          mode: "SHORT_FUNCTIONAL_WINDOW",
          clock: "Real server/DB/wall clock; not proven multi-day uptime",
          pauseResume: true,
          workerCrashAfterPayment: true,
          apiRestart: true,
          postgresRestart: true,
          unknownResult:
            "Explicit P3 possible-duplicate consent; same receipt/payment",
          venues: final.venues.map((v) => ({
            profile: v.profile,
            runId: v.runId,
            counts: v.report.counts,
            report: v.report,
            checkpoint: v.checkpoint,
          })),
          storage: final.storage,
        },
        null,
        2,
      ),
    );
    console.log("LAB2 functional acceptance passed");
  }
} finally {
  await stop(worker);
  await stop(web);
  await stop(api);
  log.end();
}
