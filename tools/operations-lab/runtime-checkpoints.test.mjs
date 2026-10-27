import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pauseReadyVenues,
  changeControlWithRecovery,
  waitForReadCondition,
  waitForFaultCrashWithSiblingCheckpoint,
} from "./runtime-checkpoints.mjs";

test("a faster sibling pauses while the faulted venue is still reaching its payment", async () => {
  let exited = false;
  const paused = [];
  await waitForFaultCrashWithSiblingCheckpoint(
    () => exited,
    async () => [
      { profile: "DE", mode: "RUNNING", counts: { own: 3 } },
      { profile: "AL", mode: "RUNNING", counts: { own: 5 } },
    ],
    async (profile) => paused.push(profile),
    {
      wait: async (condition, deadline) => {
        assert.equal(deadline, 180000);
        assert.equal(await condition(), false);
        assert.deepEqual(paused, ["AL"]);
        exited = true;
        assert.equal(await condition(), true);
      },
    },
  );
  assert.deepEqual(paused, ["AL"]);
});

test("crash observation never accepts an already completed sibling checkpoint", async () => {
  await assert.rejects(
    waitForFaultCrashWithSiblingCheckpoint(
      () => false,
      async () => [{ profile: "AL", mode: "STOPPED", counts: { own: 18 } }],
      async () => assert.fail("Terminal state must not be changed"),
      { wait: async (condition) => condition() },
    ),
    /AL STOPPED/,
  );
});

test("status polling survives a classified read timeout but still requires the condition", async () => {
  let time = 0,
    reads = 0;
  await waitForReadCondition(
    async () => {
      reads++;
      if (reads === 1)
        throw new Error("LAB_OPERATOR_READ_TIMEOUT", {
          cause: { code: "LAB_TRANSIENT_OPERATOR_READ" },
        });
      return reads === 3;
    },
    5,
    {
      now: () => time,
      delay: async () => {
        time++;
      },
    },
  );
  assert.equal(reads, 3);
});

test("status polling keeps its deadline and refuses auth, domain and mutation errors", async () => {
  let time = 0;
  await assert.rejects(
    waitForReadCondition(
      async () => {
        throw new Error("LAB_OPERATOR_READ_TIMEOUT", {
          cause: { code: "LAB_TRANSIENT_OPERATOR_READ" },
        });
      },
      2,
      {
        now: () => time,
        delay: async () => {
          time++;
        },
      },
    ),
    /CONDITION_TIMEOUT/,
  );
  assert.equal(time, 2);
  for (const message of [
    "LAB_OPERATOR_401",
    "NEEDS_REVIEW",
    "MUTATION_TIMEOUT",
  ]) {
    await assert.rejects(
      waitForReadCondition(async () => {
        throw new Error(message);
      }),
      new RegExp(message),
    );
  }
});
test("recovery observes an already committed pause without another mutation", async () => {
  let venue = { profile: "DE", mode: "RUNNING", version: 4 },
    mutations = 0;
  await changeControlWithRecovery(
    "DE",
    "PAUSED",
    async (path, body) => {
      if (path === "/status") return { venues: [venue] };
      assert.equal(body.expectedVersion, 4);
      mutations++;
      venue = { ...venue, mode: "PAUSED", version: 5 };
      throw new Error("Server has closed the connection.");
    },
    { delay: async () => {} },
  );
  assert.equal(mutations, 1);
  assert.equal(venue.version, 5);
});
test("recovery waits for a transient read and uses the observed CAS version", async () => {
  let reads = 0,
    mutations = 0;
  await changeControlWithRecovery(
    "AL",
    "PAUSED",
    async (path, body) => {
      if (path === "/status") {
        if (++reads === 1)
          throw new Error("LAB_OPERATOR_409", {
            cause: { code: "LAB_TRANSIENT_DATABASE" },
          });
        return { venues: [{ profile: "AL", mode: "RUNNING", version: 7 }] };
      }
      assert.equal(body.expectedVersion, 7);
      mutations++;
    },
    { delay: async () => {} },
  );
  assert.equal(reads, 2);
  assert.equal(mutations, 1);
});
test("control recovery is bounded and never hides review/domain errors", async () => {
  let calls = 0;
  await assert.rejects(
    changeControlWithRecovery(
      "DE",
      "PAUSED",
      async () => {
        calls++;
        throw new Error("Server has closed the connection.");
      },
      { attempts: 2, delay: async () => {} },
    ),
    /closed the connection/,
  );
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    changeControlWithRecovery(
      "DE",
      "RUNNING",
      async () => {
        calls++;
        throw new Error("NEEDS_REVIEW");
      },
      { delay: async () => {} },
    ),
    /NEEDS_REVIEW/,
  );
  assert.equal(calls, 1);
});
test("pauses a faster venue before waiting for the slower venue", async () => {
  const calls = [],
    pause = async (profile) => calls.push(profile),
    ready = (v) => v.own >= 3;
  assert.equal(
    await pauseReadyVenues(
      [
        { profile: "DE", mode: "RUNNING", own: 3 },
        { profile: "AL", mode: "RUNNING", own: 1 },
      ],
      ready,
      pause,
    ),
    false,
  );
  assert.deepEqual(calls, ["DE"]);
  assert.equal(
    await pauseReadyVenues(
      [
        { profile: "DE", mode: "PAUSED", own: 3 },
        { profile: "AL", mode: "RUNNING", own: 3 },
      ],
      ready,
      pause,
    ),
    false,
  );
  assert.deepEqual(calls, ["DE", "AL"]);
  assert.equal(
    await pauseReadyVenues(
      [
        { profile: "DE", mode: "PAUSED", own: 3 },
        { profile: "AL", mode: "PAUSED", own: 3 },
      ],
      ready,
      pause,
    ),
    true,
  );
});
test("fails explicitly if a checkpoint reaches a terminal/review state", async () => {
  await assert.rejects(
    pauseReadyVenues(
      [{ profile: "DE", mode: "STOPPED", own: 18 }],
      () => true,
      async () => assert.fail("Must not send invalid control"),
    ),
    /DE STOPPED/,
  );
});
