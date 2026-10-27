import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { PrismaClient } from "@prisma/client";

import { spawnCommandSync } from "./process-command.mjs";

const apiOrigin = "http://127.0.0.1:4300";
// Keep the isolated CI restore target off the runner's occupied 55432 port.
// Explicit local overrides still win; the application database is unchanged.
const restorePort =
  process.env.RESTORE_POSTGRES_PORT ?? (process.env.CI ? "15432" : "55432");
if (!/^\d+$/.test(restorePort) || +restorePort < 1 || +restorePort > 65535) {
  throw new Error("RESTORE_POSTGRES_PORT must be a valid TCP port");
}
// Compose and the rehearsal client must resolve the same isolated target port.
process.env.RESTORE_POSTGRES_PORT = restorePort;
const targetHostUrl = `postgresql://flowgastronomie_restore:flowgastronomie_restore@127.0.0.1:${restorePort}/flowgastronomie_restore`;
const targetContainerUrl =
  "postgresql://flowgastronomie_restore:flowgastronomie_restore@127.0.0.1:5432/flowgastronomie_restore";
const sourceUrl = process.env.DATABASE_URL;
const startedAt = Date.now();
let api;
let sessionCookie = "";
let temporaryDirectory;
let sourcePrisma;
let targetPrisma;

if (!sourceUrl) {
  throw new Error("DATABASE_URL is required for the backup/restore rehearsal");
}

function databaseIdentity(value) {
  const url = new URL(value);
  const hostname = ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    ? "loopback"
    : url.hostname;
  return `${hostname}:${url.port || "5432"}${url.pathname}`;
}

if (databaseIdentity(sourceUrl) === databaseIdentity(targetHostUrl)) {
  throw new Error(
    "The restore target must be different from the source database",
  );
}

function runText(command, args, options = {}) {
  const result = spawnCommandSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${options.label ?? command} failed (${result.error?.code ?? result.status}):\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result.stdout.trim();
}

function runArchive(command, args, options = {}) {
  const result = spawnCommandSync(command, args, {
    cwd: process.cwd(),
    encoding: null,
    maxBuffer: 100 * 1024 * 1024,
    stdio: "pipe",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${options.label ?? command} failed:\n${result.stderr?.toString("utf8") ?? ""}`,
    );
  }
  return result.stdout;
}

async function waitFor(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The isolated API is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function keyCounts(client) {
  const [tenants, venues, products, tableOrders, onlineOrders, auditEvents] =
    await Promise.all([
      client.tenant.count(),
      client.venue.count(),
      client.product.count(),
      client.order.count(),
      client.onlineOrder.count(),
      client.auditEvent.count(),
    ]);
  return { tenants, venues, products, tableOrders, onlineOrders, auditEvents };
}

function sourceUrlForContainer(value) {
  const url = new URL(value);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    url.hostname = "host.docker.internal";
  }
  return url.toString();
}

try {
  runText(
    "docker",
    [
      "compose",
      "--profile",
      "restore-rehearsal",
      "rm",
      "--stop",
      "--force",
      "restore-postgres",
    ],
    { label: "restore target cleanup" },
  );
  runText(
    "docker",
    [
      "compose",
      "--profile",
      "restore-rehearsal",
      "up",
      "--detach",
      "--wait",
      "restore-postgres",
    ],
    { label: "restore target startup" },
  );

  temporaryDirectory = await mkdtemp(
    join(tmpdir(), "flowgastronomie-restore-rehearsal-"),
  );
  const backupPath = join(temporaryDirectory, "flowgastronomie.dump");
  const dump = runArchive(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "restore-postgres",
      "pg_dump",
      "--format=custom",
      "--no-owner",
      "--no-acl",
      "--dbname",
      sourceUrlForContainer(sourceUrl),
    ],
    { label: "PostgreSQL custom-format backup" },
  );
  if (dump.length === 0) throw new Error("The database dump is empty");
  await writeFile(backupPath, dump, { mode: 0o600 });

  runArchive(
    "docker",
    ["compose", "exec", "-T", "restore-postgres", "pg_restore", "--list"],
    { input: dump, label: "backup archive validation" },
  );
  runArchive(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "restore-postgres",
      "pg_restore",
      "--exit-on-error",
      "--no-owner",
      "--no-acl",
      "--dbname",
      targetContainerUrl,
    ],
    { input: dump, label: "isolated database restore" },
  );

  const migrationOutput = runText(
    "npx",
    [
      "prisma",
      "migrate",
      "status",
      "--schema",
      "packages/database/prisma/schema.prisma",
    ],
    {
      env: { ...process.env, DATABASE_URL: targetHostUrl },
      label: "restored migration status",
    },
  );
  if (!migrationOutput.includes("Database schema is up to date")) {
    throw new Error("The restored database is not at the committed migration");
  }

  sourcePrisma = new PrismaClient({
    datasources: { db: { url: sourceUrl } },
  });
  targetPrisma = new PrismaClient({
    datasources: { db: { url: targetHostUrl } },
  });
  const sourceCounts = await keyCounts(sourcePrisma);
  const restoredCounts = await keyCounts(targetPrisma);
  if (
    sourceCounts.tenants < 1 ||
    sourceCounts.venues < 1 ||
    sourceCounts.products < 1 ||
    sourceCounts.tableOrders < 1
  ) {
    throw new Error(
      `The source lacks the seeded baseline required for rehearsal: ${JSON.stringify(sourceCounts)}`,
    );
  }
  if (JSON.stringify(sourceCounts) !== JSON.stringify(restoredCounts)) {
    throw new Error(
      `Key row counts differ after restore: ${JSON.stringify({ sourceCounts, restoredCounts })}`,
    );
  }

  api = spawn(process.execPath, ["--import", "tsx", "apps/api/src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: "4300",
      DATABASE_URL: targetHostUrl,
      NODE_ENV: "development",
      WEB_ORIGIN: apiOrigin,
    },
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });
  await waitFor(`${apiOrigin}/health`);
  await waitFor(`${apiOrigin}/ready`);

  const login = await fetch(`${apiOrigin}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenantSlug: "flowgastronomie-demo",
      venueSlug: "restaurant-olive",
      email: "manager@flowgastronomie.local",
      password: "Demo1234!",
    }),
  });
  if (!login.ok)
    throw new Error(`Restored API login failed with ${login.status}`);
  sessionCookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  if (!sessionCookie) throw new Error("Restored API login set no staff cookie");

  const workspace = await fetch(`${apiOrigin}/v1/workspace/overview`, {
    headers: { cookie: sessionCookie },
  });
  if (!workspace.ok) {
    throw new Error(`Restored workspace check failed with ${workspace.status}`);
  }
  const workspaceBody = await workspace.json();
  if (workspaceBody.actor?.email !== "manager@flowgastronomie.local") {
    throw new Error("Restored workspace returned the wrong staff scope");
  }

  const onlineOrders = await fetch(`${apiOrigin}/v1/staff/online-orders`, {
    headers: { cookie: sessionCookie },
  });
  if (!onlineOrders.ok) {
    throw new Error(
      `Restored tenant order check failed with ${onlineOrders.status}`,
    );
  }
  if (!Array.isArray(await onlineOrders.json())) {
    throw new Error("Restored tenant order check returned an invalid payload");
  }
  const publicMenu = await fetch(
    `${apiOrigin}/v1/public/tables/demo-table-07/menu?locale=sq`,
  );
  if (!publicMenu.ok) {
    throw new Error(
      `Restored public menu check failed with ${publicMenu.status}`,
    );
  }
  const publicMenuBody = await publicMenu.json();
  if (publicMenuBody.venue?.slug !== "restaurant-olive") {
    throw new Error("Restored public menu returned the wrong venue scope");
  }

  console.log(
    JSON.stringify({
      recordedAt: new Date().toISOString(),
      postgres: "17-alpine",
      backupFormat: "custom",
      backupBytes: dump.length,
      sha256: createHash("sha256").update(dump).digest("hex"),
      migrationStatus: "up-to-date",
      keyRowCounts: restoredCounts,
      apiChecks: [
        "health",
        "database-readiness",
        "staff-login",
        "workspace-overview",
        "tenant-online-orders",
        "public-menu-sq",
      ],
      durationMs: Date.now() - startedAt,
      result: "passed",
    }),
  );
} finally {
  if (sessionCookie) {
    await fetch(`${apiOrigin}/v1/auth/logout`, {
      method: "POST",
      headers: { cookie: sessionCookie },
    }).catch(() => undefined);
  }
  api?.kill("SIGTERM");
  await sourcePrisma?.$disconnect();
  await targetPrisma?.$disconnect();
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  spawnSync(
    "docker",
    [
      "compose",
      "--profile",
      "restore-rehearsal",
      "rm",
      "--stop",
      "--force",
      "restore-postgres",
    ],
    { cwd: process.cwd(), stdio: "ignore" },
  );
}
