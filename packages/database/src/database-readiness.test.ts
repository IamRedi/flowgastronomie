import { describe, expect, it, vi } from "vitest";

import { createDatabaseReadinessProbe } from "./database-readiness.js";

describe("database readiness probe", () => {
  it("resolves after the database query succeeds", async () => {
    const query = vi.fn(async () => [{ ready: 1 }]);

    await expect(
      createDatabaseReadinessProbe(query).check(),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledOnce();
  });

  it("propagates connection failures without translating provider details", async () => {
    const failure = new Error("database unavailable");
    const probe = createDatabaseReadinessProbe(async () =>
      Promise.reject(failure),
    );

    await expect(probe.check()).rejects.toBe(failure);
  });
});
