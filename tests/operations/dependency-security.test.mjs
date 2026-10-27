import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);

test(
  "PM2 exact-directory watching still restarts on changes and closes cleanly",
  { timeout: 15000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "flow-pm2-watch-"));
    const entry = join(root, "worker.js");
    await writeFile(entry, "initial");
    let restarted;
    const change = new Promise((resolve) => {
      restarted = resolve;
    });
    const god = {
      restartProcessName(name, done) {
        restarted(name);
        done(null, []);
      },
    };
    require("pm2/lib/Watcher.js")(god);
    const app = {
      pm_id: 91827,
      name: "synthetic-watch-regression",
      pm_cwd: root,
      watch: true,
      watch_delay: 0,
    };
    try {
      god.watch.enable(app);
      const watcher = god.watch._watchers[app.pm_id];
      await new Promise((resolve, reject) => {
        watcher.once("ready", resolve);
        watcher.once("error", reject);
      });
      await writeFile(entry, "changed");
      assert.equal(await change, app.name);
      assert.equal(god.watch.disable(app), true);
      await watcher.close();
      assert.equal(god.watch.disable(app), false);
    } finally {
      const watcher = god.watch._watchers[app.pm_id];
      if (watcher) await watcher.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("PM2 watcher filtering handles nested brace input within a fixed CPU budget", () => {
  const watcher = createRequire(require.resolve("pm2/package.json")).resolve(
    "chokidar",
  );
  const code = `(async()=>{const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'); const root=await fs.mkdtemp(path.join(os.tmpdir(),'flow-brace-watch-')); let w; try {await fs.writeFile(path.join(root,'worker.js'),'synthetic'); const c=require(${JSON.stringify(watcher)}); const nested='{'.repeat(32768)+'x'+'}'.repeat(32768); w=c.watch(root,{ignored:nested}); await new Promise((resolve,reject)=>{w.once('ready',resolve);w.once('error',reject);});} finally {if(w)await w.close();await fs.rm(root,{recursive:true,force:true});}})().catch(()=>process.exitCode=1);`;
  const result = spawnSync(process.execPath, ["-e", code], {
    encoding: "utf8",
    timeout: 3000,
  });
  assert.equal(
    result.error,
    undefined,
    "Nested input must finish within its CPU budget",
  );
  assert.equal(result.status, 0, result.stderr);
});

test("FTP directory parsing stays bounded for the published malformed-listing regression", () => {
  const parser = require.resolve("basic-ftp/dist/parseList");
  const code = `const {parseList}=require(${JSON.stringify(parser)});
    const malformed='-rw-r--r-- 1 '+'a '.repeat(32768)+'!';
    const files=parseList(malformed+'\\r\\n-rw-r--r-- 1 owner group 42 Jan 1 2020 file.txt\\r\\n');
    require('node:assert/strict').equal(files.length,1);
    require('node:assert/strict').equal(files[0].name,'file.txt');`;
  const result = spawnSync(process.execPath, ["-e", code], {
    encoding: "utf8",
    timeout: 3000,
  });
  assert.equal(
    result.error,
    undefined,
    "Parser must complete within its CPU budget",
  );
  assert.equal(result.status, 0, result.stderr);
});

test("YAML empty merge sources count against the configured merge budget", () => {
  const yaml = require("js-yaml");
  const source =
    "empty: &empty [" +
    "{},".repeat(20).slice(0, -1) +
    "]\nvalue:\n  <<: *empty\n";
  assert.throws(
    () => yaml.load(source, { maxTotalMergeKeys: 10 }),
    /maxTotalMergeKeys/,
  );
});
