import { afterEach, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { StaffIdentity } from "@flowgastronomie/database";

const db = vi.hoisted(() => ({
  all: vi.fn(async () => ({
    month: "2026-10",
    businesses: [],
    totals: [],
    estimatedTotalUsd: 0,
    emergencyDisabled: false,
  })),
  tenant: vi.fn(async (tenantId: string) => ({ tenantId, providers: [] })),
  limit: vi.fn(async () => ({})),
  emergency: vi.fn(async () => ({})),
}));
vi.mock("@flowgastronomie/database", () => ({
  platformImageUsage: db.all,
  tenantImageUsage: db.tenant,
  setTenantImageLimit: db.limit,
  setImageEmergencyDisabled: db.emergency,
}));
import { registerPlatformAiUsageRoutes } from "./platform-ai-usage-routes.js";

const owner = {
  tenantId: "platform-tenant",
  venueId: "v1",
  userId: "operator",
  membershipId: "m1",
  role: "OWNER",
} as StaffIdentity;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("exposes all tenants only to the exact configured platform operator", async () => {
  vi.stubEnv("PLATFORM_ADMIN_TENANT_ID", "platform-tenant");
  vi.stubEnv("PLATFORM_ADMIN_USER_ID", "operator");
  vi.stubEnv("WEB_ORIGIN", "https://app.example.test");
  const app = Fastify();
  let actor = owner;
  registerPlatformAiUsageRoutes(app, async () => actor);
  expect(
    (await app.inject({ method: "GET", url: "/v1/platform/ai-usage" }))
      .statusCode,
  ).toBe(200);
  actor = { ...owner, tenantId: "other-business" };
  expect(
    (await app.inject({ method: "GET", url: "/v1/platform/ai-usage" }))
      .statusCode,
  ).toBe(403);
  expect(db.all).toHaveBeenCalledTimes(1);
  await app.close();
});

it("allows zero quota and emergency stop only from the trusted origin", async () => {
  vi.stubEnv("PLATFORM_ADMIN_TENANT_ID", "platform-tenant");
  vi.stubEnv("PLATFORM_ADMIN_USER_ID", "operator");
  vi.stubEnv("WEB_ORIGIN", "https://app.example.test");
  const app = Fastify();
  registerPlatformAiUsageRoutes(app, async () => owner);
  const url = "/v1/platform/ai-usage/business-a/meta";
  expect(
    (
      await app.inject({
        method: "PUT",
        url,
        payload: { monthlyLimit: 0, enabled: false },
      })
    ).statusCode,
  ).toBe(403);
  const updated = await app.inject({
    method: "PUT",
    url,
    headers: { origin: "https://app.example.test" },
    payload: { monthlyLimit: 0, enabled: false },
  });
  expect(updated.statusCode).toBe(200);
  expect(db.limit).toHaveBeenCalledWith(
    "business-a",
    "meta",
    0,
    false,
    "operator",
  );
  expect(
    (
      await app.inject({
        method: "PUT",
        url,
        headers: { origin: "https://app.example.test" },
        payload: { monthlyLimit: -1, enabled: true },
      })
    ).statusCode,
  ).toBe(400);
  expect(db.limit).toHaveBeenCalledTimes(1);
  const stopped = await app.inject({
    method: "POST",
    url: "/v1/platform/ai-usage/emergency",
    headers: { origin: "https://app.example.test" },
    payload: { disabled: true },
  });
  expect(stopped.statusCode).toBe(200);
  expect(db.emergency).toHaveBeenCalledWith(true, "operator");
  await app.close();
});
