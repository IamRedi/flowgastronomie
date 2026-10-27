import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { labEnv, inside, database, operator } from "./common.mjs";
import { mkdtemp, mkdir, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";

test("only a timed-out operator GET receives the repeatable-read classification", async () => {
  const data = await mkdtemp(join(tmpdir(), "rf-operator-timeout-"));
  const originalFetch = globalThis.fetch;
  const failure = new DOMException("synthetic timeout", "TimeoutError");
  try {
    await mkdir(join(data, ".operations-lab"));
    await writeFile(
      join(data, ".operations-lab/operator.json"),
      JSON.stringify({ secret: "synthetic-only" }),
    );
    globalThis.fetch = async () => {
      throw failure;
    };
    await assert.rejects(
      operator({ data }, "/status"),
      (error) => error.cause?.code === "LAB_TRANSIENT_OPERATOR_READ",
    );
    await assert.rejects(
      operator({ data }, "/control", { mode: "PAUSED" }),
      (error) => error === failure,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await unlink(join(data, ".operations-lab/operator.json"));
    await rmdir(join(data, ".operations-lab"));
    await rmdir(data);
  }
});

test("background launcher rejects inherited ordinary database and production", () => {
  const previousUrl = process.env.DATABASE_URL;
  const previousMode = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL =
      "postgresql://ordinary@localhost:5432/development";
    assert.throws(() => labEnv(), /inherited DATABASE_URL/);
    process.env.DATABASE_URL = database;
    process.env.NODE_ENV = "production";
    assert.throws(() => labEnv(), /production launcher/);
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
  }
});

test("fixed runtime environment disables external providers and PM2 cloud keys", () => {
  const previousUrl = process.env.DATABASE_URL;
  const previousMode = process.env.NODE_ENV;
  process.env.DATABASE_URL = database;
  process.env.NODE_ENV = "development";
  let env;
  try {
    env = labEnv();
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
  }
  assert.equal(env.DATABASE_URL, database);
  assert.equal(env.TRANSACTIONAL_EMAIL_PROVIDER, "disabled");
  assert.equal(env.WORKFORCE_PUSH_ENABLED, "false");
  for (const key of [
    "STRIPE_SECRET_KEY",
    "OPENAI_API_KEY",
    "PM2_PUBLIC_KEY",
    "PM2_SECRET_KEY",
    "KEYMETRICS_PUBLIC",
    "KEYMETRICS_SECRET",
    "PUBLIC_KEY",
    "SECRET_KEY",
  ])
    assert.equal(env[key], "");
});

test("runtime paths cannot select root, parent or a similarly named sibling", () => {
  const root = resolve("private-runtime");
  assert.equal(inside(root, join(root, "data")), join(root, "data"));
  for (const target of [root, resolve(root, ".."), root + "-other/data"])
    assert.throws(() => inside(root, target), /PATH_FORBIDDEN/);
});
