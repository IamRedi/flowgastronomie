import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "./app.js";
import {
  createBoundedDatabaseReadinessProbe,
  ReadinessConfigurationError,
  readinessTimeoutFromEnvironment,
} from "./readiness.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("API readiness", () => {
  it("reports database-backed readiness separately from liveness", async () => {
    const check = vi.fn(async () => undefined);
    const app = buildApp({ databaseReadinessProbe: { check } });
    apps.push(app);

    const readiness = await app.inject({ method: "GET", url: "/ready" });
    const liveness = await app.inject({ method: "GET", url: "/health" });

    expect(readiness.statusCode).toBe(200);
    expect(readiness.json()).toEqual({
      status: "ready",
      checks: { database: "ok" },
    });
    expect(readiness.headers["cache-control"]).toBe("no-store");
    expect(liveness.statusCode).toBe(200);
    expect(liveness.json()).toEqual({ status: "ok" });
    expect(check).toHaveBeenCalledOnce();
  });

  it("returns a sanitized 503 while leaving process liveness healthy", async () => {
    const app = buildApp({
      databaseReadinessProbe: {
        async check() {
          throw new Error(
            "connect failed for postgresql://user:password@private-host/db",
          );
        },
      },
    });
    apps.push(app);

    const readiness = await app.inject({ method: "GET", url: "/ready" });
    const liveness = await app.inject({ method: "GET", url: "/health" });

    expect(readiness.statusCode).toBe(503);
    expect(readiness.json()).toEqual({
      status: "not_ready",
      checks: { database: "unavailable" },
    });
    expect(readiness.body).not.toContain("private-host");
    expect(readiness.body).not.toContain("password");
    expect(liveness.statusCode).toBe(200);
  });

  it("times out and coalesces concurrent checks", async () => {
    const check = vi.fn(() => new Promise<void>(() => undefined));
    const app = buildApp(
      { databaseReadinessProbe: { check } },
      { readinessTimeoutMs: 20 },
    );
    apps.push(app);

    const [first, second] = await Promise.all([
      app.inject({ method: "GET", url: "/ready" }),
      app.inject({ method: "GET", url: "/ready" }),
    ]);

    expect(first.statusCode).toBe(503);
    expect(second.statusCode).toBe(503);
    expect(check).toHaveBeenCalledOnce();
  });

  it("runs a fresh database check after a settled failure", async () => {
    const check = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce(undefined);
    const probe = createBoundedDatabaseReadinessProbe({ check }, 100);

    await expect(probe.check()).rejects.toThrow("temporary outage");
    await expect(probe.check()).resolves.toBeUndefined();
    expect(check).toHaveBeenCalledTimes(2);
  });
});

describe("readiness configuration", () => {
  it("uses a safe default and accepts a bounded override", () => {
    expect(readinessTimeoutFromEnvironment({})).toBe(2_000);
    expect(
      readinessTimeoutFromEnvironment({ READINESS_TIMEOUT_MS: "3500" }),
    ).toBe(3_500);
  });

  it("rejects invalid timeout configuration", () => {
    for (const configured of ["99", "30001", "1.5", "invalid"]) {
      expect(() =>
        readinessTimeoutFromEnvironment({
          READINESS_TIMEOUT_MS: configured,
        }),
      ).toThrowError(ReadinessConfigurationError);
    }
  });
});
