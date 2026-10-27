import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "./client.js";
import {
  staffCostRepository,
  StaffCostResourceNotFoundError,
} from "./staff-cost-repository.js";
import { SubscriptionAccessDeniedError } from "./subscription-repository.js";
import type { StaffIdentity } from "./staff-auth-repository.js";

const tenantIds = new Set<string>();

async function createFixture() {
  const unique = randomUUID();
  const tenant = await prisma.tenant.create({
    data: { name: `Cost ${unique}`, slug: `cost-${unique}` },
  });
  tenantIds.add(tenant.id);
  const subscription = await prisma.subscription.create({
    data: {
      tenantId: tenant.id,
      plan: "RESTAURANT_PRO",
      status: "ACTIVE",
      currentPeriodStartedAt: new Date(Date.now() - 60_000),
      currentPeriodEndsAt: new Date(Date.now() + 86_400_000),
    },
  });
  await prisma.entitlement.create({
    data: {
      tenantId: tenant.id,
      subscriptionId: subscription.id,
      featureKey: "RECIPE_COSTING",
      enabled: true,
    },
  });
  const venue = await prisma.venue.create({
    data: {
      tenantId: tenant.id,
      name: "Cost venue",
      slug: `cost-venue-${unique}`,
      defaultLocale: "EN",
      timezone: "Europe/Berlin",
      currency: "EUR",
    },
  });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `${unique}@cost.integration.test`,
      displayName: "Cost manager",
      passwordHash: "not-used",
    },
  });
  const membership = await prisma.membership.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      userId: user.id,
      role: "MANAGER",
    },
  });
  const staff: StaffIdentity = {
    sessionId: `session-${unique}`,
    userId: user.id,
    membershipId: membership.id,
    displayName: user.displayName,
    email: user.email,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    venueId: venue.id,
    venueName: venue.name,
    venueSlug: venue.slug,
    role: "MANAGER",
  };
  return { tenant, staff };
}

describe.sequential("staff cost repository with PostgreSQL", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    await prisma.$connect();
  });

  afterEach(async () => {
    const ids = [...tenantIds];
    if (!ids.length) return;
    await prisma.supplierItemPrice.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.ingredient.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.supplier.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
    tenantIds.clear();
  });

  afterAll(async () => prisma.$disconnect());

  it("keeps ingredients, suppliers, and append-only prices scoped to the venue", async () => {
    const first = await createFixture();
    const second = await createFixture();
    const ingredient = await staffCostRepository.createIngredient({
      staff: first.staff,
      name: "Flour",
      baseUnit: "GRAM",
      allergens: ["GLUTEN"],
      active: true,
    });
    const supplier = await staffCostRepository.createSupplier({
      staff: first.staff,
      name: "Miller GmbH",
      contactName: null,
      phone: null,
      email: null,
      address: null,
      active: true,
    });

    const price = await staffCostRepository.addPrice({
      staff: first.staff,
      supplierId: supplier.id,
      ingredientId: ingredient.id,
      packQuantity: 1,
      unit: "KILOGRAM",
      priceMinor: 399,
      effectiveFrom: new Date("2026-08-10T00:00:00Z"),
    });
    expect(price.currency).toBe("EUR");

    const firstCatalog = await staffCostRepository.list(first.staff);
    expect(firstCatalog.ingredients).toHaveLength(1);
    expect(firstCatalog.suppliers).toHaveLength(1);
    expect(firstCatalog.prices).toHaveLength(1);

    const secondCatalog = await staffCostRepository.list(second.staff);
    expect(secondCatalog.ingredients).toEqual([]);
    expect(secondCatalog.suppliers).toEqual([]);
    expect(secondCatalog.prices).toEqual([]);
    await expect(
      staffCostRepository.addPrice({
        staff: second.staff,
        supplierId: supplier.id,
        ingredientId: ingredient.id,
        packQuantity: 1,
        unit: "KILOGRAM",
        priceMinor: 399,
        effectiveFrom: new Date("2026-08-10T00:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(StaffCostResourceNotFoundError);
  });

  it("denies recipe costing after its entitlement is disabled", async () => {
    const fixture = await createFixture();
    await prisma.entitlement.updateMany({
      where: { tenantId: fixture.tenant.id, featureKey: "RECIPE_COSTING" },
      data: { enabled: false },
    });

    await expect(
      staffCostRepository.list(fixture.staff),
    ).rejects.toBeInstanceOf(SubscriptionAccessDeniedError);
  });
});
