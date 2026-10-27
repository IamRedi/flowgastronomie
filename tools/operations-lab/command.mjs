import { spawn } from "node:child_process";
import { spawnCommandSync } from "../../tests/operations/process-command.mjs";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolveCommand } from "../../tests/operations/process-command.mjs";

// Deliberately never loads .env, .env.production or ordinary development config.
const database =
  "postgresql://operations_lab:operations_lab_local_only@127.0.0.1:55439/restaurantflow_operations_lab?schema=public";
if (process.env.DATABASE_URL && process.env.DATABASE_URL !== database)
  throw new Error("LAB refuses an inherited DATABASE_URL. Use a clean shell.");
if (process.env.NODE_ENV === "production")
  throw new Error("LAB refuses production.");
const env = {
  ...process.env,
  NODE_ENV: "development",
  DATABASE_URL: database,
  OPERATIONS_LAB_ENABLED: "true",
  API_PORT: "4400",
  WEB_ORIGIN: "http://127.0.0.1:3400",
  NEXT_PUBLIC_API_URL: "http://127.0.0.1:4400",
  API_INTERNAL_URL: "http://127.0.0.1:4400",
  API_URL: "http://127.0.0.1:4400",
  TRANSACTIONAL_EMAIL_PROVIDER: "disabled",
  WORKFORCE_PUSH_ENABLED: "false",
  HARDWARE_SIMULATOR_ENABLED: "true",
  BREVO_API_KEY: "",
  VAPID_PRIVATE_KEY: "",
};
const mode = process.argv[2];
mkdirSync("artifacts/operations-lab", { recursive: true });
const commands = {
  rotate: [
    process.execPath,
    ["--import", "tsx", "apps/api/src/operations-lab/rotate-credentials.ts"],
  ],
  backup: [
    process.execPath,
    ["--import", "tsx", "apps/api/src/operations-lab/backup.ts"],
  ],
  generate: [
    "npx",
    [
      "prisma",
      "generate",
      "--schema",
      "packages/database/prisma/schema.prisma",
    ],
  ],
  init: ["npx", ["tsx", "apps/api/src/operations-lab/init.ts"]],
  api: [
    process.execPath,
    ["--import", "tsx", "apps/api/src/operations-lab/server.ts"],
  ],
  day: ["npx", ["tsx", "apps/api/src/operations-lab/run-day.ts"]],
  normal: ["npx", ["tsx", "apps/api/src/operations-lab/run-normal-day.ts"]],
  worker: [
    process.execPath,
    ["--import", "tsx", "apps/api/src/operations-lab/runtime-worker.ts"],
  ],
  "runtime-probe": [
    process.execPath,
    [
      "--import",
      "tsx",
      "apps/api/src/operations-lab/runtime-acceptance.ts",
      "probe",
    ],
  ],
  "runtime-unknown": [
    process.execPath,
    [
      "--import",
      "tsx",
      "apps/api/src/operations-lab/runtime-acceptance.ts",
      "unknown",
    ],
  ],
  "runtime-parallel": [
    process.execPath,
    [
      "--import",
      "tsx",
      "apps/api/src/operations-lab/runtime-acceptance.ts",
      "parallel",
    ],
  ],
  "runtime-final": [
    process.execPath,
    [
      "--import",
      "tsx",
      "apps/api/src/operations-lab/runtime-acceptance.ts",
      "final",
    ],
  ],
  web: [
    process.execPath,
    [
      createRequire(
        new URL("../../apps/web/package.json", import.meta.url),
      ).resolve("next/dist/bin/next"),
      "dev",
      "apps/web",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3400",
    ],
  ],
  browser: [
    "npx",
    ["playwright", "test", "--config", "playwright.operations-lab.config.ts"],
  ],
  test: ["npx", ["vitest", "run", "apps/api/src/operations-lab/lab.test.ts"]],
};
if (!commands[mode])
  throw new Error(
    "Unknown Operations Lab command; see OPERATIONS_LAB_RUNTIME.md",
  );
const [cmd, args] = commands[mode];
const childCommand = resolveCommand(cmd, [...args, ...process.argv.slice(3)]);
const child = spawn(childCommand.command, childCommand.args, {
  env,
  stdio: "inherit",
  windowsHide: true,
  shell: false,
});
let shutdownTimer;
child.on("exit", (code) => {
  clearTimeout(shutdownTimer);
  if (["api", "web", "worker"].includes(mode)) process.stdin.destroy();
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
if (["api", "web", "worker"].includes(mode))
  process.stdin.on("data", (bytes) => {
    if (bytes.toString().trim() === "operations-lab-stop") {
      if (process.platform === "win32")
        spawnCommandSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      else {
        child.kill("SIGTERM");
        // Only this owned child. Active proxied SSE must not deadlock cleanup.
        shutdownTimer = setTimeout(() => {
          process.stderr.write("LAB_PROCESS_SHUTDOWN_FORCED_AFTER_10S\n");
          child.kill("SIGKILL");
        }, 10000);
      }
    }
  });
