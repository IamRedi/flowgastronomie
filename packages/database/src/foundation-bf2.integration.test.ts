import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./client.js";
import { bootstrapDemo, demoProfiles } from "./demo-workspaces.js";
import { provisionBusiness } from "./business-provisioner.js";
import { staffAuthRepository } from "./staff-auth-repository.js";
const isolatedPremiumGate = process.env.PREMIUM_DB_GATE === "true";
if (isolatedPremiumGate) {
  const target = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(target.hostname) ||
    !/^premium_gate_\d+$/.test(target.searchParams.get("schema") ?? "")
  )
    throw new Error("Demo acceptance requires an isolated premium test schema");
}
const env = {
  ...process.env,
  // Exercise the bootstrap's injected environment policy separately from the
  // Prisma test connection, which stays in the generated, loopback-only schema.
  // Production bootstrap and its strict local allowlist are unchanged.
  DATABASE_URL: isolatedPremiumGate
    ? "postgresql://localhost:5432/restaurantflow?schema=foundation_gate_1"
    : process.env.DATABASE_URL,
  NODE_ENV: "development",
  FOUNDATION_LOCAL_ENABLE: "1",
  CI: undefined,
};
const password = "foundation-demo-password";
describe.skipIf(process.env.FOUNDATION_DB_GATE !== "true")(
  "BF2 demo generations",
  () => {
    afterAll(() => prisma.$disconnect());
    it("bootstraps nine deterministic demo profiles; repeat does not duplicate", async () => {
      for (const profile of demoProfiles) {
        const a = await bootstrapDemo(profile, password, false, env);
        const b = await bootstrapDemo(profile, password, false, env);
        expect(a.tenantId).toBe(b.tenantId);
        expect(b.created).toBe(false);
        const tenant = await prisma.tenant.findUniqueOrThrow({
          where: { id: a.tenantId },
        });
        expect(tenant.kind).toBe("DEMO");
        expect(tenant.name).toContain("DEMO");
        expect(
          await prisma.venue.findUniqueOrThrow({ where: { id: a.venueId } }),
        ).toMatchObject({ timezone: "Europe/Berlin", currency: "EUR" });
        expect(
          await prisma.product.count({ where: { tenantId: a.tenantId } }),
        ).toBeGreaterThanOrEqual(12);
        expect(
          await prisma.order.count({ where: { tenantId: a.tenantId } }),
        ).toBe(0);
      }
    }, 60000);
    it("reset retires only the selected demo and preserves real tenants and audit history", async () => {
      const real = await provisionBusiness({
        requestKey: "bf2-real-untouched",
        organizationName: "Real business",
        venueName: "Real venue",
        ownerDisplayName: "Owner",
        email: "owner@real.test",
        password,
        locale: "de",
        timezone: "Europe/Berlin",
        currency: "EUR",
        plan: "WEBSITE",
        profileId: "PIZZERIA",
        applyCategories: false,
      });
      const before = await prisma.tenant.findUnique({
        where: { id: real.tenant.id },
      });
      const old = await bootstrapDemo("PIZZERIA", password, false, env);
      const login = await staffAuthRepository.login({ ...old, password });
      const fresh = await bootstrapDemo("PIZZERIA", password, true, env);
      expect(fresh.generation).toBe(old.generation + 1);
      expect(fresh.tenantId).not.toBe(old.tenantId);
      expect(
        await staffAuthRepository.authenticate(login.sessionToken),
      ).toBeNull();
      expect(
        await prisma.auditEvent.count({
          where: { tenantId: old.tenantId, action: "DEMO_GENERATION_RETIRED" },
        }),
      ).toBe(1);
      expect(
        await prisma.tenant.findUnique({ where: { id: real.tenant.id } }),
      ).toEqual(before);
      await expect(
        bootstrapDemo("PIZZERIA", password, true, { ...env, CI: "true" }),
      ).rejects.toThrow();
      await expect(
        bootstrapDemo(real.tenant.id as "PIZZERIA", password, true, env),
      ).rejects.toThrow();
    }, 30000);
  },
);
