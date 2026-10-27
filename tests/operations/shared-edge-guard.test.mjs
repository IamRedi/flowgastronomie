import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { readFileSync } from "node:fs";

test("staging guard preserves existing scheduled jobs and refuses stack/proxy changes", () => {
  const guard = "infra/staging/compose-guard.sh";
  const allowed = [
    ["ps"],
    ["exec", "-T", "proxy", "nginx", "-t"],
    ...["backup", "retention", "retention-check"].map((service) => [
      "--profile",
      "operations",
      "run",
      "--rm",
      "--no-deps",
      service,
    ]),
    [
      "--profile",
      "operations",
      "run",
      "--rm",
      "--no-deps",
      "-v",
      "/opt/flowgastronomie/current/infra/staging/../production/backup.sh:/opt/backup.sh:ro",
      "backup",
    ],
    [
      "--profile",
      "operations",
      "run",
      "--rm",
      "--no-deps",
      "-v",
      "/opt/flowgastronomie/releases/abc/infra/production/backup.sh:/opt/backup.sh:ro",
      "backup",
    ],
  ];
  for (const args of allowed) {
    assert.equal(
      spawnSync("sh", [guard, ...args]).status,
      0,
      JSON.stringify(args),
    );
  }
  for (const args of [
    ["up", "-d"],
    ["up", "-d", "proxy"],
    ["down"],
    ["restart"],
    ["--profile", "operations", "run", "--rm", "--no-deps", "proxy"],
    ["--profile", "operations", "run", "--rm", "--no-deps", "backup", "proxy"],
    ["--profile", "operations", "run", "--rm", "backup"],
  ]) {
    assert.equal(
      spawnSync("sh", [guard, ...args]).status,
      2,
      JSON.stringify(args),
    );
  }
});

test("persistent shared-edge overlay explicitly retains only BusinessSite frontend", () => {
  const overlay = readFileSync(
    "infra/production/shared-edge.compose.yaml",
    "utf8",
  );
  assert.match(overlay, /businesssite_public_web_20261020/);
  assert.doesNotMatch(overlay, /businesssite_target_internal|5432/);
  assert.match(overlay, /create_host_path: false/);
  const wrapper = readFileSync("infra/production/shared-edge.sh", "utf8");
  assert.match(wrapper, /shared-edge-transaction\.py" recreate/);
  assert.match(wrapper, /-f "\$state\/shared-edge\.compose\.yaml"/);
});
