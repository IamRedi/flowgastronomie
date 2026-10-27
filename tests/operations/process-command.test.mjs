import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { join } from "node:path";

import { resolveCommand, spawnCommandSync } from "./process-command.mjs";

for (const platform of ["linux", "darwin"]) {
  test(`${platform} preserves native npm and npx commands`, () => {
    for (const command of ["npm", "npx", "docker", "git"]) {
      const args = ["--version"];
      assert.deepEqual(resolveCommand(command, args, { platform }), {
        command,
        args,
      });
    }
  });
}

test("Windows invokes npm/npx CLI with Node and preserves literal arguments", () => {
  for (const command of ["npm", "npx"]) {
    assert.deepEqual(
      resolveCommand(command, ["path with spaces", "literal&argument"], {
        platform: "win32",
        node: "node.exe",
        npmExecPath: join("npm with spaces", "bin", "npm-cli.js"),
      }),
      {
        command: "node.exe",
        args: [
          join("npm with spaces", "bin", `${command}-cli.js`),
          "path with spaces",
          "literal&argument",
        ],
      },
    );
  }
  assert.deepEqual(
    resolveCommand("docker", ["compose"], { platform: "win32" }),
    {
      command: "docker",
      args: ["compose"],
    },
  );
});

test("Windows can locate the npm bundled beside Node outside npm run", () => {
  assert.deepEqual(
    resolveCommand("npm", ["--version"], {
      platform: "win32",
      node: join("node with spaces", "node.exe"),
      npmExecPath: null,
    }),
    {
      command: join("node with spaces", "node.exe"),
      args: [
        join("node with spaces", "node_modules", "npm", "bin", "npm-cli.js"),
        "--version",
      ],
    },
  );
});

test("installed npm and npx start without a shell on the current platform", () => {
  for (const command of ["npm", "npx"]) {
    const result = spawnCommandSync(command, ["--version"], {
      encoding: "utf8",
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
  }
});

test("inherited output streams large child output without a capture buffer", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { spawnCommandSync } from ${JSON.stringify(new URL("./process-command.mjs", import.meta.url).href)};
    const result = spawnCommandSync(process.execPath,
      ["-e", "process.stdout.write('x'.repeat(100000))"],
      { stdio: "inherit", maxBuffer: 1 });
    process.exit(result.status ?? 1);
  `,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.length, 100000);
});
