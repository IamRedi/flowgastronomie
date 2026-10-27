import { describe, expect, it } from "vitest";

import { databaseReadinessProbe } from "./database-readiness.js";

describe("database readiness integration", () => {
  it("executes the readiness query against PostgreSQL", async () => {
    await expect(databaseReadinessProbe.check()).resolves.toBeUndefined();
  });
});
