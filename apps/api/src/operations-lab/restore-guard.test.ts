import { it, expect } from "vitest";
import { assertRestoreEndpoint, restoreDatabase } from "./restore-guard.js";
it("admits only the explicitly flagged disposable restore endpoint", () => {
  const env = {
    NODE_ENV: "development",
    OPERATIONS_LAB_ENABLED: "true",
    LAB_DISPOSABLE_RESTORE: "true",
    DATABASE_URL: restoreDatabase,
  };
  expect(() => assertRestoreEndpoint(env)).not.toThrow();
  for (const DATABASE_URL of [
    restoreDatabase.replace("127.0.0.1", "neon.invalid"),
    restoreDatabase.replace("55441", "5432"),
    restoreDatabase.replace("operations_lab_restore?", "operations_lab?"),
    restoreDatabase + "&host=remote.invalid",
  ])
    expect(() => assertRestoreEndpoint({ ...env, DATABASE_URL })).toThrow();
  expect(() =>
    assertRestoreEndpoint({ ...env, NODE_ENV: "production" }),
  ).toThrow();
  expect(() =>
    assertRestoreEndpoint({ ...env, LAB_DISPOSABLE_RESTORE: "false" }),
  ).toThrow();
});
