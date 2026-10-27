import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { request } from "node:http";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "flowgastronomie-m1-"));
const source = join(temporary, "source");
const project = `flow-m1-${randomBytes(4).toString("hex")}`;
// Exercise URI decoding and pgpass escaping with punctuation in the credential.
const password = `${randomBytes(24).toString("hex")}:@back\\slash`;
const canary = `excluded-secret-${randomBytes(24).toString("hex")}`;
const started = Date.now();
let composeArgs;
const images = ["api", "web", "operations", "backup"].map(
  (service) => `flowgastronomie-${service}:${project}`,
);

function run(command, args, { cwd = source, live = false } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.on("error", reject);
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        output += chunk.toString();
        if (live) process.stdout.write(chunk);
      });
    }
    child.on("close", (code) => {
      if (code === 0) done(output.trim());
      else reject(new Error(`${command} failed (${code}):\n${output}`));
    });
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function excludesSecrets(file) {
  let tail = Buffer.alloc(0);
  const needles = [canary, password].map((value) => Buffer.from(value));
  for await (const chunk of createReadStream(file)) {
    const bytes = Buffer.concat([tail, chunk]);
    for (const needle of needles) assert.equal(bytes.includes(needle), false);
    tail = bytes.subarray(-128);
  }
}

// Node fetch drops custom Host headers. Native HTTP exercises both proxy
// virtual hosts over loopback without requiring edits to the machine's DNS.
function proxyRequest(port, hostname, path) {
  return new Promise((done, reject) => {
    const req = request(
      `http://127.0.0.1:${port}${path}`,
      {
        headers: { Host: `${hostname}:${port}`, "Accept-Language": "sq" },
        signal: AbortSignal.timeout(15_000),
      },
      async (res) => {
        try {
          const chunks = [];
          for await (const chunk of res) chunks.push(chunk);
          const headers = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (value !== undefined) {
              for (const item of Array.isArray(value) ? value : [value]) {
                headers.append(name, item);
              }
            }
          }
          done(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode,
              headers,
            }),
          );
        } catch (error) {
          reject(error);
        }
      },
    );
    req.on("error", reject);
    req.end();
  });
}

try {
  await rm(resolve(root, "artifacts/m1-package-gate.json"), { force: true });
  await mkdir(source);
  // Only Git source inputs, including the pending review diff. No generated
  // files or developer environment are carried into the clean build directory.
  const files = await run(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root },
  );
  const sourceHash = createHash("sha256");
  for (const file of [...new Set(files.split("\0").filter(Boolean))].sort()) {
    assert(!file.split("/").includes(".."));
    assert(!/(^|\/)\.env(?!.*\.example$)/.test(file));
    const target = join(source, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, file), target);
    sourceHash
      .update(file)
      .update("\0")
      .update(await readFile(target))
      .update("\0");
  }
  await writeFile(join(source, ".env.production"), `BUILD_SECRET=${canary}\n`);
  await writeFile(join(source, "excluded-private-key.pem"), canary);
  await writeFile(
    join(source, "apps/web/.env.local"),
    `BUILD_SECRET=${canary}\n`,
  );
  await writeFile(
    join(source, "apps/api/src/excluded-private-key.pem"),
    canary,
  );
  const port = await freePort();
  const envFile = join(temporary, "gate.env");
  await writeFile(
    envFile,
    [
      `RELEASE_TAG=${project}`,
      "WEB_HOST=web.localhost",
      "API_HOST=api.localhost",
      `PROXY_HTTP_PORT=${port}`,
      `WEB_ORIGIN=http://web.localhost:${port}`,
      `NEXT_PUBLIC_API_URL=http://api.localhost:${port}`,
      `DATABASE_URL=postgresql://package_gate:${encodeURIComponent(password)}@gate-postgres:5432/package_gate`,
      `DATABASE_URL_DIRECT=postgresql://package_gate:${encodeURIComponent(password)}@gate-postgres:5432/package_gate?sslmode=disable`,
      `GATE_DB_PASSWORD=${password}`,
      "TRANSACTIONAL_EMAIL_PROVIDER=disabled",
      `BACKUP_DIRECTORY=${temporary.replaceAll("\\", "/")}/backups`,
    ].join("\n"),
  );
  await mkdir(join(temporary, "backups"));
  composeArgs = [
    "compose",
    "--env-file",
    envFile,
    "--project-name",
    project,
    "-f",
    "compose.production.yaml",
    "-f",
    "tests/operations/production-package.compose.yaml",
    "--profile",
    "operations",
  ];
  const compose = (args, options) =>
    run("docker", [...composeArgs, ...args], options);
  await compose(["config", "--quiet"]);
  console.info(
    "M1: building API, web, operations and backup from clean source",
  );
  await compose(["build", "api", "web", "migrate", "backup"], { live: true });
  await compose([
    "up",
    "--detach",
    "--wait",
    "--wait-timeout",
    "90",
    "gate-postgres",
  ]);
  console.info("M1: applying migrations to an empty disposable target");
  await compose(["run", "--rm", "--no-deps", "migrate"], { live: true });
  // Idempotent deployment must also succeed without changing applied migrations.
  await compose(["run", "--rm", "--no-deps", "migrate"]);
  await compose([
    "up",
    "--detach",
    "--wait",
    "--wait-timeout",
    "120",
    "api",
    "web",
    "proxy",
  ]);
  for (const endpoint of ["health", "ready"]) {
    const response = await proxyRequest(port, "api.localhost", `/${endpoint}`);
    assert.equal(response.status, 200, endpoint);
    const body = await response.json();
    assert.equal(body.status, endpoint === "ready" ? "ready" : "ok");
  }
  const response = await proxyRequest(port, "web.localhost", "/sq");
  assert.equal(response.status, 200, "proxied web");
  assert.match(await response.text(), /<html/);
  const redirect = await proxyRequest(port, "web.localhost", "/");
  assert.equal(redirect.status, 307, "packaged Next proxy");
  assert.equal(
    new URL(redirect.headers.get("location"), `http://web.localhost:${port}`)
      .pathname,
    "/sq",
  );
  await compose([
    "exec",
    "-T",
    "web",
    "node",
    "-e",
    'fetch(process.env.API_URL + "/ready").then(r => { if (!r.ok) process.exit(1); })',
  ]);
  // Exercise packaged jobs without fixtures or demo identities.
  await compose(["run", "--rm", "--no-deps", "retention"]);
  await compose(["run", "--rm", "--no-deps", "retention-check"]);
  await compose(["run", "--rm", "--no-deps", "backup"]);
  console.info(
    "M1: checking final image files and metadata for secret canaries",
  );
  for (const image of images) {
    const metadata = await run("docker", ["image", "inspect", image]);
    const history = await run("docker", ["history", "--no-trunc", image]);
    for (const value of [password, canary]) {
      assert(!metadata.includes(value));
      assert(!history.includes(value));
    }
    const container = await run("docker", ["create", image]);
    try {
      const archive = join(temporary, "image.tar");
      await run("docker", ["export", "--output", archive, container]);
      await excludesSecrets(archive);
      await rm(archive);
    } finally {
      await run("docker", ["rm", container]);
    }
  }
  await run("docker", [
    "run",
    "--rm",
    "--entrypoint",
    "node",
    images[0],
    "-e",
    'for (const p of ["typescript", "vitest", "tsx", "prisma", "next"]) { try { require.resolve(p); process.exit(1); } catch {} }',
  ]);
  const evidence = {
    milestone: "M1",
    result: "green",
    checkedAt: new Date().toISOString(),
    baseRevision: await run("git", ["rev-parse", "HEAD"], { cwd: root }),
    source: "clean source snapshot including pending review changes",
    sourceSha256: sourceHash.digest("hex"),
    database: "empty disposable PostgreSQL 17 (Neon deployment belongs to M2)",
    checks: [
      "images",
      "compose",
      "migrations",
      "migration-retry",
      "health",
      "ready",
      "web",
      "web-to-api",
      "retention",
      "retention-check",
      "logical-backup",
      "secret-exclusion",
      "api-production-dependencies",
    ],
    durationMs: Date.now() - started,
  };
  await mkdir(resolve(root, "artifacts"), { recursive: true });
  await writeFile(
    resolve(root, "artifacts/m1-package-gate.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.info(JSON.stringify(evidence));
} catch (error) {
  // The gate creates test credentials, but avoid printing even these on failure.
  console.error(
    String(error)
      .replaceAll(password, "[redacted]")
      .replaceAll(canary, "[redacted]"),
  );
  process.exitCode = 1;
} finally {
  if (composeArgs) {
    await run("docker", [
      ...composeArgs,
      "down",
      "--volumes",
      "--remove-orphans",
    ]).catch(() => {
      process.exitCode = 1;
    });
  }
  assert.equal(resolve(dirname(temporary)), resolve(tmpdir()));
  assert(temporary.split(/[\\/]/).at(-1).startsWith("flowgastronomie-m1-"));
  await rm(temporary, { recursive: true, force: true });
  if (process.exitCode) {
    await rm(resolve(root, "artifacts/m1-package-gate.json"), { force: true });
  }
}
