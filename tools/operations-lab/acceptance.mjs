import { spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { canonicalEvidence } from "./evidence.mjs";
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const child = (mode) =>
  spawn(process.execPath, ["tools/operations-lab/command.mjs", mode], {
    stdio: ["api", "web"].includes(mode)
      ? ["pipe", "inherit", "inherit"]
      : "inherit",
    env: {
      ...process.env,
      NEXT_DIST_DIR: ".next-operations-lab",
      OPERATIONS_LAB_EXTERNAL_WEB: "true",
    },
    windowsHide: true,
    shell: false,
  });
const run = (mode) =>
  new Promise((resolve, reject) => {
    const c = child(mode);
    c.on("error", reject);
    c.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("LAB " + mode + " failed")),
    );
  });
async function ready() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch("http://127.0.0.1:4400/lab/identity");
      if ((await r.json()).marker === "RESTAURANTFLOW_OPERATIONS_LAB_V1")
        return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("LAB API did not become ready");
}
async function snapshot() {
  const files = (await readdir("artifacts/operations-lab"))
    .filter((f) => f.endsWith("-reconciliation.json"))
    .sort();
  for (const file of await readdir("artifacts/operations-lab/normal-day"))
    if (file.endsWith("-reconciliation.json")) files.push("normal-day/" + file);
  return Promise.all(
    files.map(async (file) => {
      const r = JSON.parse(
        await readFile("artifacts/operations-lab/" + file, "utf8"),
      );
      return {
        file,
        counts: r.counts,
        totals: r.totals,
        orders: r.orders,
        receipts: r.receipts,
        hardware: r.hardware,
        discrepancies: r.discrepancies,
      };
    }),
  );
}
let api, web;
async function stop() {
  if (!api) return;
  const done = new Promise((resolve) => api.on("exit", resolve));
  api.stdin.end("operations-lab-stop\n");
  await done;
  api = undefined;
}
try {
  // Requires a free lab port; never silently attaches to an unrelated instance.
  try {
    await fetch("http://127.0.0.1:4400/health");
    throw new Error("Stop the existing lab API before acceptance");
  } catch (e) {
    if (e.message === "Stop the existing lab API before acceptance") throw e;
  }
  api = child("api");
  await ready();
  await run("day");
  web = child("web");
  for (let i = 0; i < 240; i++) {
    try {
      const r = await fetch("http://127.0.0.1:3400/en");
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
    if (i === 239) throw new Error("LAB web unavailable");
  }
  await run("normal");
  const before = await snapshot();
  await stop();
  api = child("api");
  await ready();
  await run("day");
  await run("normal");
  const after = await snapshot();
  await writeFile(
    "artifacts/operations-lab/replay-before.json",
    JSON.stringify(canonicalEvidence(before), null, 2),
  );
  await writeFile(
    "artifacts/operations-lab/replay-after.json",
    JSON.stringify(canonicalEvidence(after), null, 2),
  );
  if (
    JSON.stringify(canonicalEvidence(before)) !==
    JSON.stringify(canonicalEvidence(after))
  )
    throw new Error("Restart/replay changed financial or hardware evidence");
  await run("test");
  await run("browser");
  await writeFile(
    "artifacts/operations-lab/acceptance.json",
    JSON.stringify(
      {
        version: 1,
        revision,
        status: "passed",
        postgres: "dedicated persistent local PostgreSQL 17",
        realApi: true,
        browser: true,
        restartReplay: "same order/payment/receipt/PDF/print/drawer identities",
        venues: after,
        providers: "disabled",
        physicalHardware: false,
        clock: "real wall time",
        deployment: false,
      },
      null,
      2,
    ),
  );
} finally {
  if (web) {
    const done = new Promise((resolve) => web.on("exit", resolve));
    web.stdin.end("operations-lab-stop\n");
    await done;
  }
  await stop();
}
