import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { publicProductionProblems } from "../../infra/production/public-preflight.mjs";
import { isolatedStagingTemplate } from "../../infra/production/prepare-staging-edge.mjs";

test("bundled signup resolves canonical template assets without workspace packages", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "flow-template-runtime-"));
  try {
    const assets = resolve("packages/database/assets/showcases");
    const output = join(cwd, "assets.mjs");
    await build({
      entryPoints: ["packages/database/src/premium-showcase-assets.ts"],
      outfile: output,
      bundle: true,
      format: "esm",
      platform: "node",
      logLevel: "silent",
    });
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { premiumShowcaseAssetsDirectory } from './assets.mjs';
      import { readFile } from 'node:fs/promises';
      console.log(await readFile(premiumShowcaseAssetsDirectory()+'/sources.json','utf8'));
    `,
      ],
      {
        cwd,
        encoding: "utf8",
        env: { ...process.env, PREMIUM_SHOWCASE_ASSETS_DIRECTORY: assets },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(result.stdout),
      JSON.parse(await readFile(join(assets, "sources.json"), "utf8")),
    );
    assert.ok(
      JSON.parse(result.stdout).some((x) => x.profileId === "PIZZERIA"),
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

const production = {
  RELEASE_TAG: "a".repeat(40),
  WEB_HOST: "123serve.de",
  API_HOST: "api.123serve.de",
  WEB_ORIGIN: "https://123serve.de",
  NEXT_PUBLIC_API_URL: "https://api.123serve.de",
  DATABASE_URL:
    "postgresql://production:prod-only@ep-prod-pooler.example/production?sslmode=require",
  DATABASE_URL_DIRECT:
    "postgresql://production:prod-only@ep-prod.example/production?sslmode=require",
  BACKUP_DIRECTORY: "/var/lib/flowgastronomie-public/backups",
  CREATIVE_STORAGE_DIRECTORY: "/var/lib/flowgastronomie-public/media",
  TRANSACTIONAL_EMAIL_PROVIDER: "brevo",
  BREVO_API_KEY: "synthetic-key",
  TRANSACTIONAL_EMAIL_FROM_ADDRESS: "service@example.test",
  PLATFORM_OPERATOR_NAME: "Synthetic operator",
  PLATFORM_OPERATOR_ADDRESS: "Synthetic address",
  PLATFORM_OPERATOR_EMAIL: "operator@example.test",
  PLATFORM_PRIVACY_NOTICE_DE: "Synthetic fixture notice",
  MENU_IMPORT_PROVIDER: "disabled",
  WEBSITE_COPY_AI_ENABLED: "true",
  PUBLIC_EDGE_CONFIG: "/etc/flowgastronomie-public/public.conf",
};
const staging = {
  DATABASE_URL: "postgresql://stage:stage-only@ep-stage-pooler.example/staging",
  DATABASE_URL_DIRECT: "postgresql://stage:stage-only@ep-stage.example/staging",
  BACKUP_DIRECTORY: "/var/lib/flowgastronomie/backups",
  CREATIVE_STORAGE_DIRECTORY: "/var/lib/flowgastronomie/media",
};

test("shared edge cannot resolve staging through ambiguous cross-project aliases", () => {
  const source =
    "proxy_pass http://api:4000;\nproxy_pass http://web:3000;\n# retained headers";
  assert.equal(
    isolatedStagingTemplate(source),
    "proxy_pass http://flowgastronomie-api-1:4000;\nproxy_pass http://flowgastronomie-web-1:3000;\n# retained headers",
  );
  for (const changed of [
    source + "\nhttp://api:4000",
    source.replace("web:3000", "changed:3000"),
  ])
    assert.throws(() => isolatedStagingTemplate(changed));
});

test("public launch fails closed on staging data, shared secrets, media, missing mail and mutable source", () => {
  assert.deepEqual(publicProductionProblems(production, staging), []);
  for (const change of [
    {
      DATABASE_URL: staging.DATABASE_URL,
      DATABASE_URL_DIRECT: staging.DATABASE_URL_DIRECT,
    },
    {
      DATABASE_URL: production.DATABASE_URL.replace("prod-only", "stage-only"),
    },
    { CREATIVE_STORAGE_DIRECTORY: staging.CREATIVE_STORAGE_DIRECTORY },
    { BACKUP_DIRECTORY: `${staging.BACKUP_DIRECTORY}/production` },
    { WEB_ORIGIN: "https://staging.123serve.de" },
    { TRANSACTIONAL_EMAIL_PROVIDER: "disabled" },
    { BREVO_API_KEY: "" },
    { PLATFORM_OPERATOR_NAME: "" },
    { PLATFORM_PRIVACY_NOTICE_DE: "" },
    { RELEASE_TAG: "latest" },
    { HARDWARE_SIMULATOR_ENABLED: "true" },
  ])
    assert.ok(
      publicProductionProblems({ ...production, ...change }, staging).length >
        0,
    );
  assert.ok(publicProductionProblems(production, {}).length > 0);
  const errors = publicProductionProblems(
    { ...production, DATABASE_URL: "invalid-private-value" },
    staging,
  );
  assert.ok(!JSON.stringify(errors).includes("invalid-private-value"));
});

test("merged public Compose isolates the network and storage and never binds public ports", (t) => {
  const r = spawnSync(
    "docker",
    [
      "compose",
      "--profile",
      "operations",
      "-f",
      "compose.production.yaml",
      "-f",
      "compose.public.yaml",
      "config",
      "--format",
      "json",
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, ...production },
    },
  );
  if (r.error?.code === "ENOENT") {
    t.skip("Docker Compose CLI unavailable; runtime gate remains pending");
    return;
  }
  assert.equal(r.status, 0, r.stderr);
  const config = JSON.parse(r.stdout);
  assert.equal(config.services.api.environment.WEBSITE_COPY_AI_ENABLED, "true");
  assert.equal(
    config.services.api.environment.CREATIVE_IMAGE_MODEL,
    "gpt-image-2.5-flare",
  );
  assert.equal(config.name, "flowgastronomie-public");
  assert.equal(
    config.services.api.environment.TRUST_PROXY,
    "172.30.43.2,172.30.43.3",
  );
  assert.equal(
    config.services.api.environment.HARDWARE_SIMULATOR_ENABLED,
    "false",
  );
  assert.equal(
    config.services.api.volumes[0].source,
    production.CREATIVE_STORAGE_DIRECTORY,
  );
  assert.equal(
    config.services.web.environment.PLATFORM_OPERATOR_NAME,
    production.PLATFORM_OPERATOR_NAME,
  );
  assert.equal(config.services.proxy.ports[0].host_ip, "127.0.0.1");
  assert.equal(
    config.networks.application.ipam.config[0].subnet,
    "172.30.43.0/28",
  );
  assert.equal(config.services.backup.environment.BACKUP_MEDIA, "true");
});
