import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { LabRun } from "@flowgastronomie/domain";

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock("@flowgastronomie/database", () => ({ prisma: db }));
vi.mock("./guard.js", () => ({
  assertLabScope: vi.fn(async () => {}),
  hash: (input: string) => createHash("sha256").update(input).digest("hex"),
}));
import { Actions } from "./actions.js";

const run: LabRun = {
  version: 1,
  id: "synthetic-run",
  tenantId: "synthetic-tenant",
  venueId: "synthetic-venue",
  scenarioVersion: "claim-test",
  seed: 1,
  businessDate: "2026-10-20",
  status: "RUNNING",
  checkpoint: {},
};
const request = { order: "synthetic" };
const pending = () => ({
  status: "PENDING",
  result: null,
  request_hash: createHash("sha256")
    .update(JSON.stringify(request))
    .digest("hex"),
  lease_until: null,
  attempts: 0,
});
const tx = { $queryRaw: vi.fn(), $executeRaw: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
  db.$queryRaw.mockResolvedValue([{ status: "RUNNING" }]);
  db.$executeRaw.mockResolvedValue(1);
  tx.$queryRaw.mockResolvedValue([pending()]);
  tx.$executeRaw.mockResolvedValue(1);
  db.$transaction.mockImplementation(async (callback) => callback(tx));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it("never executes an action after claim commit failure; later attempt and replay execute once", async () => {
  const actions = new Actions(run);
  const execute = vi.fn(async () => ({ id: "persisted-order" }));
  const expired = Object.assign(new Error("synthetic private detail"), {
    code: "P2028",
  });
  db.$transaction.mockImplementationOnce(async (callback) => {
    await callback(tx); // The ledger callback finished, but COMMIT failed.
    throw expired;
  });
  const perform = () =>
    actions.perform("create", "guest", request, {}, true, execute);
  await expect(perform()).rejects.toBe(expired);
  expect(execute).not.toHaveBeenCalled();
  expect(db.$transaction).toHaveBeenCalledTimes(1); // No hidden retry.
  const diagnostic = JSON.parse(vi.mocked(console.error).mock.calls[0]![0]);
  expect(diagnostic).toMatchObject({
    phase: "LAB_ACTION_CLAIM",
    code: "P2028",
  });
  expect(JSON.stringify(diagnostic)).not.toContain("synthetic private detail");
  expect(diagnostic.eventHash).toMatch(/^[a-f0-9]{64}$/);
  await expect(perform()).resolves.toEqual({ id: "persisted-order" });
  expect(execute).toHaveBeenCalledTimes(1);
  tx.$queryRaw.mockResolvedValue([
    { ...pending(), status: "SUCCEEDED", result: { id: "persisted-order" } },
  ]);
  await expect(perform()).resolves.toEqual({ id: "persisted-order" });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(db.$transaction.mock.calls[0]![1]).toEqual({
    maxWait: 5000,
    timeout: 15000,
  });
});

it("retains the active actor exclusion", async () => {
  const actions = new Actions(run, {
    waiter: { membershipId: "member", sessionId: "session" },
  });
  tx.$queryRaw.mockResolvedValue([{ event_id: "other-claim" }]);
  const execute = vi.fn();
  await expect(
    actions.perform("create", "waiter", request, {}, true, execute),
  ).rejects.toThrow("LAB_ACTOR_BUSY");
  expect(execute).not.toHaveBeenCalled();
});

it("requires review for an expired ambiguous non-idempotent action", async () => {
  tx.$queryRaw.mockResolvedValue([
    { ...pending(), status: "LEASED", lease_until: new Date(0), attempts: 1 },
  ]);
  const execute = vi.fn();
  await expect(
    new Actions(run).perform("create", "guest", request, {}, false, execute),
  ).rejects.toThrow("LAB_ACTION_NEEDS_REVIEW");
  expect(execute).not.toHaveBeenCalled();
});

it("retains input identity checks", async () => {
  tx.$queryRaw.mockResolvedValue([
    { ...pending(), request_hash: "f".repeat(64) },
  ]);
  const execute = vi.fn();
  await expect(
    new Actions(run).perform("create", "guest", request, {}, true, execute),
  ).rejects.toThrow("LAB_ACTION_INPUT_CHANGED");
  expect(execute).not.toHaveBeenCalled();
});
