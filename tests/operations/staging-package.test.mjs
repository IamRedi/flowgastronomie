import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import https from "node:https";
import http from "node:http";
import test from "node:test";

const root = process.cwd();
mkdirSync("artifacts", { recursive: true });
const temporary = mkdtempSync(resolve("artifacts/m2-local-"));
const prefix = `m2-${randomBytes(5).toString("hex")}`;
const resources = [];
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
    ...options,
  });
  assert.equal(result.status, 0, `${command}: ${result.stderr}`);
  return result.stdout.trim();
};
const docker = (...args) => run("docker", args);
const mount = (from, to, readonly = false) =>
  `${from.replaceAll("\\", "/")}:${to}${readonly ? ":ro" : ""}`;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const certDir = join(temporary, "tls/live/flowgastronomie-staging");
const environment = {
  ...process.env,
  RELEASE_TAG: prefix,
  WEB_HOST: "web.localhost",
  API_HOST: "api.localhost",
  WEB_ORIGIN: "https://web.localhost",
  NEXT_PUBLIC_API_URL: "https://api.localhost",
  DATABASE_URL: "postgresql://synthetic:fixture@db/staging",
  DATABASE_URL_DIRECT: "postgresql://synthetic:fixture@db/staging",
  TRANSACTIONAL_EMAIL_PROVIDER: "disabled",
  BACKUP_DIRECTORY: join(temporary, "backups"),
  CREATIVE_STORAGE_DIRECTORY: join(temporary, "media"),
  TLS_DIRECTORY: join(temporary, "tls"),
  ACME_DIRECTORY: join(temporary, "acme"),
};

test("M2 local package only (not external staging acceptance)", async (suite) => {
  try {
    for (const dir of [
      certDir,
      environment.BACKUP_DIRECTORY,
      environment.CREATIVE_STORAGE_DIRECTORY,
      environment.ACME_DIRECTORY,
    ])
      mkdirSync(dir, { recursive: true });
    await suite.test(
      "Compose preserves M1 isolation and makes media persistent",
      () => {
        const config = JSON.parse(
          run(
            "docker",
            [
              "compose",
              "--env-file",
              "production.env.example",
              "-f",
              "compose.production.yaml",
              "-f",
              "compose.staging.yaml",
              "--profile",
              "operations",
              "config",
              "--format",
              "json",
            ],
            { env: environment },
          ),
        );
        assert.deepEqual(
          config.services.proxy.ports.map((p) => p.published).sort(),
          ["443", "80"],
        );
        assert.equal(config.services.api.ports, undefined);
        assert.equal(config.services.web.ports, undefined);
        assert.equal(
          config.services.api.environment.TRUST_PROXY,
          "172.30.42.2",
        );
        assert.equal(
          config.services.api.environment.MENU_IMPORT_PROVIDER,
          "disabled",
        );
        assert.equal(
          config.services.api.environment.CREATIVE_OPENAI_API_KEY,
          undefined,
        );
        assert(
          config.services.api.volumes.some(
            (v) =>
              v.target === "/var/lib/flowgastronomie/creative" &&
              v.bind?.create_host_path !== true,
          ),
        );
        assert(
          config.services.backup.volumes.some(
            (v) => v.target === "/media" && v.read_only,
          ),
        );
        assert.equal(config.services.backup.environment.BACKUP_MEDIA, "true");
        assert.equal(
          config.services.backup.build.args.BACKUP_POSTGRES_MAJOR,
          "18",
        );
      },
    );
    docker("network", "create", prefix);
    const openssl =
      process.platform === "win32"
        ? "C:/Program Files/Git/usr/bin/openssl.exe"
        : "openssl";
    run(openssl, [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      join(certDir, "privkey.pem"),
      "-out",
      join(certDir, "fullchain.pem"),
      "-subj",
      "/CN=api.localhost",
      "-addext",
      "subjectAltName=DNS:api.localhost,DNS:web.localhost",
    ]);
    writeFileSync(
      join(temporary, "backend.mjs"),
      `import http from 'node:http';
for (const port of [3000,4000]) http.createServer((q,s)=> {
 if(q.url==='/events'){s.writeHead(200,{'Content-Type':'text/event-stream'});s.write('data: first\\n\\n');setTimeout(()=>s.end('data: second\\n\\n'),1500);}
 else {s.setHeader('Content-Type','application/json');s.end(JSON.stringify({proto:q.headers['x-forwarded-proto'],ip:q.headers['x-forwarded-for']}));}
}).listen(port,'0.0.0.0');`,
    );
    const backend = `${prefix}-backend`;
    resources.push(backend);
    docker(
      "run",
      "-d",
      "--name",
      backend,
      "--network",
      prefix,
      "--network-alias",
      "api",
      "--network-alias",
      "web",
      "-v",
      mount(join(temporary, "backend.mjs"), "/test.mjs", true),
      "node:22-bookworm",
      "node",
      "/test.mjs",
    );
    const proxy = `${prefix}-proxy`;
    resources.push(proxy);
    docker(
      "run",
      "-d",
      "--name",
      proxy,
      "--network",
      prefix,
      "-p",
      "127.0.0.1::8080",
      "-p",
      "127.0.0.1::8443",
      "-e",
      "WEB_HOST=web.localhost",
      "-e",
      "API_HOST=api.localhost",
      "-e",
      "NGINX_ENVSUBST_FILTER=^(WEB_HOST|API_HOST)$",
      "-v",
      mount(
        resolve("infra/staging/nginx.conf.template"),
        "/etc/nginx/templates/default.conf.template",
        true,
      ),
      "-v",
      mount(environment.TLS_DIRECTORY, "/etc/letsencrypt", true),
      "nginx:1.30.4-alpine",
    );
    await wait(1500);
    docker("exec", proxy, "nginx", "-t");
    const port = Number(docker("port", proxy, "8443/tcp").split(":").at(-1));
    const httpPort = Number(
      docker("port", proxy, "8080/tcp").split(":").at(-1),
    );
    const ca = readFileSync(join(certDir, "fullchain.pem"));
    const request = (path, headers = {}) =>
      new Promise((done, reject) => {
        const started = Date.now();
        const q = https.get(
          {
            hostname: "127.0.0.1",
            port,
            servername: "api.localhost",
            ca,
            path,
            headers: { Host: "api.localhost", ...headers },
            timeout: 5000,
          },
          (s) => {
            let data = "";
            let first;
            s.on("data", (chunk) => {
              first ??= Date.now() - started;
              data += chunk;
            });
            s.on("end", () =>
              done({
                status: s.statusCode,
                data,
                first,
                elapsed: Date.now() - started,
                headers: s.headers,
              }),
            );
          },
        );
        q.on("error", reject);
        q.on("timeout", () => q.destroy(new Error("request timed out")));
      });
    await suite.test(
      "TLS proxy replaces spoofed headers and streams SSE on reconnect",
      async () => {
        const redirect = await new Promise((done, reject) => {
          http
            .get(
              {
                hostname: "127.0.0.1",
                port: httpPort,
                path: "/sq",
                headers: { Host: "web.localhost" },
              },
              (response) => {
                response.resume();
                done({
                  status: response.statusCode,
                  location: response.headers.location,
                });
              },
            )
            .on("error", reject);
        });
        assert.equal(redirect.status, 308);
        assert.equal(redirect.location, "https://web.localhost/sq");
        const response = await request("/", {
          "X-Forwarded-For": "203.0.113.9",
          "X-Forwarded-Proto": "http",
        });
        assert.equal(response.status, 200);
        assert.equal(JSON.parse(response.data).proto, "https");
        assert.notEqual(JSON.parse(response.data).ip, "203.0.113.9");
        assert.equal(response.headers["x-robots-tag"], "noindex, nofollow");
        for (let i = 0; i < 2; i++) {
          const stream = await request("/events");
          assert.match(stream.data, /data: first/);
          assert.match(stream.data, /data: second/);
          assert(
            stream.elapsed - stream.first > 1000,
            "first SSE chunk must arrive before stream end",
          );
        }
      },
    );
    await suite.test(
      "database/media backup restores into an isolated empty database",
      async () => {
        docker(
          "build",
          "-q",
          "-f",
          "infra/production/api.Dockerfile",
          "--target",
          "backup",
          "--build-arg",
          "BACKUP_POSTGRES_MAJOR=18",
          "-t",
          `${prefix}-backup`,
          ".",
        );
        const db = `${prefix}-db`;
        resources.push(db);
        docker(
          "run",
          "-d",
          "--name",
          db,
          "--network",
          prefix,
          "--tmpfs",
          "/var/lib/postgresql",
          "-e",
          "POSTGRES_PASSWORD=synthetic-only",
          "postgres:18-alpine",
        );
        for (let i = 0; i < 30; i++) {
          if (
            spawnSync(
              "docker",
              ["exec", db, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
              {
                windowsHide: true,
              },
            ).status === 0
          )
            break;
          await wait(500);
        }
        const payload = "synthetic immutable creative file";
        const hash = createHash("sha256").update(payload).digest("hex");
        writeFileSync(
          join(environment.CREATIVE_STORAGE_DIRECTORY, hash),
          payload,
        );
        docker(
          "exec",
          db,
          "psql",
          "-U",
          "postgres",
          "-c",
          `CREATE TABLE evidence (asset_hash text); INSERT INTO evidence VALUES ('${hash}');`,
        );
        docker(
          "run",
          "--rm",
          // CI runs as a non-root Linux user; retain 0600 without chmod.
          "--user",
          process.getuid ? `${process.getuid()}:${process.getgid()}` : "0:0",
          "--network",
          prefix,
          "-e",
          `DATABASE_URL_DIRECT=postgresql://postgres:synthetic-only@${db}/postgres?sslmode=disable`,
          "-e",
          "BACKUP_MEDIA=true",
          "-v",
          mount(environment.BACKUP_DIRECTORY, "/backups"),
          "-v",
          mount(environment.CREATIVE_STORAGE_DIRECTORY, "/media", true),
          `${prefix}-backup`,
        );
        const { readdirSync } = await import("node:fs");
        const marker = readdirSync(environment.BACKUP_DIRECTORY).find((name) =>
          name.endsWith(".complete"),
        );
        assert(marker, "only full bundles have completion markers");
        const base = marker.slice(0, -9);
        for (const extension of [".dump", ".media.tar.gz"]) {
          const bytes = readFileSync(
            join(environment.BACKUP_DIRECTORY, base + extension),
          );
          assert(
            readFileSync(
              join(environment.BACKUP_DIRECTORY, base + extension + ".sha256"),
              "utf8",
            ).startsWith(createHash("sha256").update(bytes).digest("hex")),
          );
        }
        docker(
          "cp",
          join(environment.BACKUP_DIRECTORY, base + ".dump"),
          `${db}:/tmp/rehearsal.dump`,
        );
        docker("exec", db, "createdb", "-U", "postgres", "isolated_restore");
        docker(
          "exec",
          db,
          "pg_restore",
          "-U",
          "postgres",
          "-d",
          "isolated_restore",
          "--exit-on-error",
          "--no-owner",
          "/tmp/rehearsal.dump",
        );
        assert.equal(
          docker(
            "exec",
            db,
            "psql",
            "-U",
            "postgres",
            "-d",
            "isolated_restore",
            "-tAc",
            "SELECT asset_hash FROM evidence",
          ),
          hash,
        );
        const extracted = docker(
          "run",
          "--rm",
          "--entrypoint",
          "sh",
          "-v",
          mount(environment.BACKUP_DIRECTORY, "/backups", true),
          `${prefix}-backup`,
          "-c",
          `tar -xOzf /backups/${base}.media.tar.gz ./${hash}`,
        );
        assert.equal(extracted, payload);
        const python = process.platform === "win32" ? "python" : "python3";
        run(python, [
          "-c",
          "import importlib.util,sys,time; s=importlib.util.spec_from_file_location('monitor','infra/staging/monitor.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);assert m.backup_fresh(sys.argv[1]);assert not m.backup_fresh(sys.argv[1],time.time()+27*3600)",
          environment.BACKUP_DIRECTORY,
        ]);
        rmSync(
          join(environment.BACKUP_DIRECTORY, base + ".media.tar.gz.sha256"),
        );
        run(python, [
          "-c",
          "import importlib.util,sys; s=importlib.util.spec_from_file_location('monitor','infra/staging/monitor.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);assert not m.backup_fresh(sys.argv[1])",
          environment.BACKUP_DIRECTORY,
        ]);
        // Missing media fails closed and does not produce a valid backup bundle.
        const failed = spawnSync(
          "docker",
          [
            "run",
            "--rm",
            "--network",
            prefix,
            "-e",
            `DATABASE_URL_DIRECT=postgresql://postgres:synthetic-only@${db}/postgres?sslmode=disable`,
            "-e",
            "BACKUP_MEDIA=true",
            "-v",
            mount(environment.BACKUP_DIRECTORY, "/backups"),
            `${prefix}-backup`,
          ],
          { windowsHide: true },
        );
        assert.notEqual(failed.status, 0);
      },
    );
  } finally {
    for (const name of resources.reverse())
      spawnSync("docker", ["rm", "-f", name], { windowsHide: true });
    spawnSync("docker", ["network", "rm", prefix], { windowsHide: true });
    spawnSync("docker", ["image", "rm", `${prefix}-backup`], {
      windowsHide: true,
    });
    assert.equal(dirname(temporary), resolve(root, "artifacts"));
    assert(temporary.startsWith(resolve(root, "artifacts/m2-local-")));
    rmSync(temporary, { recursive: true, force: true });
  }
});
