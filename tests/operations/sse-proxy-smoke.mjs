import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

import { PrismaClient } from "@prisma/client";

import { spawnCommandSync } from "./process-command.mjs";

const apiOrigin = "http://127.0.0.1:4200";
const proxyOrigin = "http://127.0.0.1:4280";
const managerMembershipId = "demo-manager-membership";
const prisma = new PrismaClient();
let membershipDeactivated = false;
let sessionCookie = "";

function run(command, args) {
  const result = spawnCommandSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${result.error?.code ?? result.status}):\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result.stdout.trim();
}

async function waitFor(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The process or proxy is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function readUntil(stream, expected, timeoutMs) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let received = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SSE read timed out")), remaining),
      ),
    ]);
    if (result.done) {
      throw new Error(`SSE closed before receiving ${expected}`);
    }
    received += decoder.decode(result.value, { stream: true });
    if (received.includes(expected)) return { reader, received };
  }
  throw new Error(`SSE did not emit ${expected}`);
}

async function waitForClose(reader, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("SSE did not close after scope revocation")),
          remaining,
        ),
      ),
    ]);
    if (result.done) return;
  }
  throw new Error("SSE did not close after scope revocation");
}

async function openStaffStream() {
  const controller = new AbortController();
  const response = await fetch(`${proxyOrigin}/v1/staff/online-orders/events`, {
    headers: {
      accept: "text/event-stream",
      cookie: sessionCookie,
    },
    signal: controller.signal,
  });
  return { controller, response };
}

const api = spawn(
  process.execPath,
  ["--import", "tsx", "apps/api/src/server.ts"],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: "4200",
      WEB_ORIGIN: proxyOrigin,
    },
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  },
);

try {
  await waitFor(`${apiOrigin}/health`);
  await waitFor(`${apiOrigin}/ready`);
  run("docker", [
    "compose",
    "--profile",
    "sse-smoke",
    "up",
    "--detach",
    "--wait",
    "sse-proxy",
  ]);
  await waitFor(`${proxyOrigin}/health`);
  await waitFor(`${proxyOrigin}/ready`);

  const login = await fetch(`${proxyOrigin}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenantSlug: "flowgastronomie-demo",
      venueSlug: "restaurant-olive",
      email: "manager@flowgastronomie.local",
      password: "Demo1234!",
    }),
  });
  if (!login.ok) throw new Error(`Proxy login failed with ${login.status}`);
  sessionCookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  if (!sessionCookie) throw new Error("Proxy login did not set a staff cookie");

  const first = await openStaffStream();
  if (!first.response.ok || !first.response.body) {
    throw new Error(
      `Initial SSE connection failed with ${first.response.status}`,
    );
  }
  if (
    !first.response.headers.get("content-type")?.includes("text/event-stream")
  ) {
    throw new Error("Proxy did not preserve the event-stream content type");
  }
  if (first.response.headers.get("content-encoding")) {
    throw new Error("Proxy transformed the SSE response with compression");
  }
  if (!first.response.headers.get("cache-control")?.includes("no-cache")) {
    throw new Error("Proxy did not preserve the SSE no-cache policy");
  }
  if (first.response.headers.get("age")) {
    throw new Error("Proxy returned a cached SSE response");
  }
  const firstEvent = await readUntil(
    first.response.body,
    "event: orders",
    2_000,
  );
  if (!firstEvent.received.includes("retry: 3000")) {
    throw new Error("SSE reconnect hint was not preserved by the proxy");
  }
  first.controller.abort();
  await firstEvent.reader.cancel().catch(() => undefined);

  const reconnected = await openStaffStream();
  if (!reconnected.response.ok || !reconnected.response.body) {
    throw new Error(`SSE reconnect failed with ${reconnected.response.status}`);
  }
  const reconnectedEvent = await readUntil(
    reconnected.response.body,
    "event: orders",
    2_000,
  );

  await prisma.membership.update({
    where: { id: managerMembershipId },
    data: { active: false },
  });
  membershipDeactivated = true;
  const revokedAt = Date.now();
  await waitForClose(reconnectedEvent.reader, 8_000);
  const revokedScopeClosedAfterMs = Date.now() - revokedAt;

  const rejected = await openStaffStream();
  if (rejected.response.status !== 401) {
    rejected.controller.abort();
    throw new Error(
      `Revoked staff reconnect returned ${rejected.response.status}, expected 401`,
    );
  }
  rejected.controller.abort();

  console.log(
    JSON.stringify({
      proxy: "nginx:1.30.4-alpine",
      initialStream: "passed",
      disconnectReconnect: "passed",
      revokedScopeClosedAfterMs,
      revokedReconnectStatus: 401,
    }),
  );
} finally {
  if (membershipDeactivated) {
    await prisma.membership.update({
      where: { id: managerMembershipId },
      data: { active: true },
    });
  }
  if (sessionCookie) {
    await fetch(`${apiOrigin}/v1/auth/logout`, {
      method: "POST",
      headers: { cookie: sessionCookie },
    }).catch(() => undefined);
  }
  await prisma.$disconnect();
  spawnSync(
    "docker",
    [
      "compose",
      "--profile",
      "sse-smoke",
      "rm",
      "--stop",
      "--force",
      "sse-proxy",
    ],
    { cwd: process.cwd(), stdio: "ignore" },
  );
  api.kill("SIGTERM");
}
