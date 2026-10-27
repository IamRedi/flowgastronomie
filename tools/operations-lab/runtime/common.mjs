import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCommand } from "../../../tests/operations/process-command.mjs";
export const sourceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const rootOption = process.argv.indexOf("--runtime-root");
if (rootOption >= 0 && !isAbsolute(process.argv[rootOption + 1] ?? ""))
  throw new Error("Provide an absolute --runtime-root");
export const runtimeRoot = resolve(
  (rootOption >= 0
    ? process.argv[rootOption + 1]
    : process.env.LAB_RUNTIME_ROOT) ??
    join(sourceRoot, ".operations-lab-runtime"),
);
export const database =
  "postgresql://operations_lab:operations_lab_local_only@127.0.0.1:55439/restaurantflow_operations_lab?schema=public";
export function labEnv(extra = {}) {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== database)
    throw new Error("LAB refuses inherited DATABASE_URL");
  if (process.env.NODE_ENV === "production")
    throw new Error("LAB refuses a production launcher");
  return {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL: database,
    OPERATIONS_LAB_ENABLED: "true",
    HARDWARE_SIMULATOR_ENABLED: "true",
    API_PORT: "4400",
    WEB_ORIGIN: "http://127.0.0.1:3400",
    NEXT_PUBLIC_API_URL: "http://127.0.0.1:4400",
    API_INTERNAL_URL: "http://127.0.0.1:4400",
    API_URL: "http://127.0.0.1:4400",
    TRANSACTIONAL_EMAIL_PROVIDER: "disabled",
    WORKFORCE_PUSH_ENABLED: "false",
    BREVO_API_KEY: "",
    VAPID_PRIVATE_KEY: "",
    STRIPE_SECRET_KEY: "",
    OPENAI_API_KEY: "",
    CREATIVE_OPENAI_API_KEY: "",
    MENU_IMPORT_OPENAI_API_KEY: "",
    SMTP_URL: "",
    PM2_PUBLIC_KEY: "",
    PM2_SECRET_KEY: "",
    KEYMETRICS_PUBLIC_KEY: "",
    KEYMETRICS_SECRET_KEY: "",
    KEYMETRICS_PUBLIC: "",
    KEYMETRICS_SECRET: "",
    PUBLIC_KEY: "",
    SECRET_KEY: "",
    ...extra,
  };
}
export async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
export async function save(file, value) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600 });
}
export function inside(root, target) {
  const r = relative(root, target);
  if (!r || r.startsWith("..") || isAbsolute(r))
    throw new Error("LAB_RUNTIME_PATH_FORBIDDEN");
  return target;
}
export async function config() {
  const c = await json(join(runtimeRoot, "runtime.json"));
  if (
    c.version !== 1 ||
    !/^[a-f0-9]{40}$/.test(c.revision) ||
    c.marker !== "RFO_PINNED_LOCAL_RUNTIME_V1"
  )
    throw new Error("LAB_RUNTIME_CONFIG_INVALID");
  inside(await realpath(runtimeRoot), await realpath(c.code));
  inside(await realpath(runtimeRoot), await realpath(c.data));
  if (c.code === c.data || c.pm2Home !== join(c.data, ".pm2"))
    throw new Error("LAB_RUNTIME_CONFIG_INVALID");
  if (
    ![
      "EXPLICIT_OPERATOR_REVISION_APPROVAL",
      "TEMPORARY_ACCEPTANCE_ONLY",
    ].includes(c.approval)
  )
    throw new Error("LAB_RUNTIME_APPROVAL_INVALID");
  return c;
}
export async function run(cmd, args, cwd, options = {}) {
  const resolved = resolveCommand(cmd, args);
  return new Promise((resolveResult, reject) => {
    const child = spawn(resolved.command, resolved.args, {
      cwd,
      env: options.env ?? labEnv(),
      windowsHide: true,
      shell: false,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let output = "";
    if (options.capture) {
      child.stdout.on("data", (b) => (output += b));
      child.stderr.on("data", (b) => (output += b));
    }
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolveResult(output)
        : reject(new Error(`LAB command failed (${code}): ${cmd}`)),
    );
  });
}
export async function pm2(c, args, capture = false) {
  return run(
    process.execPath,
    [join(c.code, "node_modules/pm2/bin/pm2"), ...args],
    c.data,
    {
      capture,
      env: labEnv({
        PM2_HOME: c.pm2Home,
        PM2_DISCRETE_MODE: "true",
        PM2_DISABLE_GIT: "true",
      }),
    },
  );
}
export async function processes(c) {
  // Never publish PM2's full environment (it may contain local secrets).
  const raw = await pm2(c, ["jlist"], true),
    start = raw.indexOf("[{"),
    empty = raw.indexOf("[]");
  const list = JSON.parse(
    start >= 0 ? raw.slice(start) : empty >= 0 ? "[]" : raw,
  );
  return list
    .filter((p) => p.name?.startsWith("rflow-lab-"))
    .map((p) => ({
      name: p.name,
      pid: p.pid,
      status: p.pm2_env.status,
      restarts: p.pm2_env.restart_time,
      startedAt: p.pm2_env.pm_uptime,
      exitCode: p.pm2_env.exit_code ?? null,
    }));
}
export async function operator(c, path, body) {
  const key = (await json(join(c.data, ".operations-lab/operator.json")))
    .secret;
  let r;
  try {
    r = await fetch("http://127.0.0.1:4400/lab/operator" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: "Bearer " + key,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    if (body === undefined && error.name === "TimeoutError")
      throw new Error("LAB_OPERATOR_READ_TIMEOUT", {
        cause: { code: "LAB_TRANSIENT_OPERATOR_READ" },
      });
    throw error;
  }
  if (!r.ok) {
    const payload = await r.json().catch(() => null);
    const transient =
      /Server has closed the connection|Can't reach database server|Connection terminated unexpectedly/.test(
        payload?.code ?? payload?.message ?? "",
      );
    // Expose a classification, never raw Prisma messages or request secrets.
    throw new Error(
      "LAB_OPERATOR_" + r.status,
      transient ? { cause: { code: "LAB_TRANSIENT_DATABASE" } } : undefined,
    );
  }
  return r.json();
}
export async function ready(url, ms = 90000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("LAB_SERVICE_NOT_READY");
}
