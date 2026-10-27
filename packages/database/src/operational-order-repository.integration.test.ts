import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { onlineOrderRepository } from "./online-order-repository.js";
import { operationalOrderRepository } from "./operational-order-repository.js";
import { prisma } from "./client.js";
import type { StaffIdentity } from "./staff-auth-repository.js";
import { staffOperationsRepository } from "./staff-operations-repository.js";

const tenantIds = new Set<string>();

async function createFixture() {
  const unique = randomUUID();
  const tenant = await prisma.tenant.create({
    data: { name: `Operational ${unique}`, slug: `operational-${unique}` },
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
  await prisma.entitlement.createMany({
    data: [
      {
        tenantId: tenant.id,
        subscriptionId: subscription.id,
        featureKey: "PUBLIC_WEBSITE",
        enabled: true,
      },
      {
        tenantId: tenant.id,
        subscriptionId: subscription.id,
        featureKey: "ONLINE_ORDERING",
        enabled: true,
      },
    ],
  });
  const venue = await prisma.venue.create({
    data: {
      tenantId: tenant.id,
      name: "Operational venue",
      slug: `operational-venue-${unique}`,
      defaultLocale: "EN",
      timezone: "Europe/Berlin",
      currency: "EUR",
      onlinePickupEnabled: true,
    },
  });
  const category = await prisma.menuCategory.create({
    // Public V3 checkout also requires its parent category to be published.
    data: { tenantId: tenant.id, venueId: venue.id, published: true },
  });
  const product = await prisma.product.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      categoryId: category.id,
      priceMinor: 1_200,
      currency: "EUR",
      published: true,
      available: true,
      station: "KITCHEN",
      translations: {
        create: {
          tenantId: tenant.id,
          venueId: venue.id,
          locale: "EN",
          name: "Dish",
        },
      },
    },
  });
  await prisma.venueWebsite.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      publicSlug: `operational-public-${unique}`,
      status: "PUBLISHED",
      publishedAt: new Date(),
      openingHours: [
        { day: "MONDAY", closed: false, opensAt: "00:00", closesAt: "23:59" },
        { day: "TUESDAY", closed: false, opensAt: "00:00", closesAt: "23:59" },
        {
          day: "WEDNESDAY",
          closed: false,
          opensAt: "00:00",
          closesAt: "23:59",
        },
        { day: "THURSDAY", closed: false, opensAt: "00:00", closesAt: "23:59" },
        { day: "FRIDAY", closed: false, opensAt: "00:00", closesAt: "23:59" },
        { day: "SATURDAY", closed: false, opensAt: "00:00", closesAt: "23:59" },
        { day: "SUNDAY", closed: false, opensAt: "00:00", closesAt: "23:59" },
      ],
    },
  });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `${unique}@integration.test`,
      displayName: "Operational owner",
      passwordHash: "not-used",
    },
  });
  const membership = await prisma.membership.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      userId: user.id,
      role: "OWNER",
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
    role: "OWNER",
  };
  return {
    tenant,
    venue,
    product,
    staff,
    publicSlug: `operational-public-${unique}`,
  };
}

describe.sequential("operational order repository with PostgreSQL", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    await prisma.$connect();
  });

  afterEach(async () => {
    const ids = [...tenantIds];
    if (!ids.length) return;
    await prisma.operationalOrderEvent.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.order.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.onlineOrder.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
    tenantIds.clear();
  });

  afterAll(async () => prisma.$disconnect());

  it("maps each scoped table and online order once into the canonical projection", async () => {
    const fixture = await createFixture();
    const table = await prisma.diningTable.create({
      data: {
        tenantId: fixture.tenant.id,
        venueId: fixture.venue.id,
        label: "07",
        qrTokenHash: randomUUID(),
      },
    });
    const session = await prisma.tableSession.create({
      data: {
        tenantId: fixture.tenant.id,
        venueId: fixture.venue.id,
        tableId: table.id,
      },
    });
    const guest = await prisma.tableGuest.create({
      data: {
        tenantId: fixture.tenant.id,
        venueId: fixture.venue.id,
        tableSessionId: session.id,
        tokenHash: randomUUID(),
      },
    });
    const tableOrder = await prisma.order.create({
      data: {
        tenantId: fixture.tenant.id,
        venueId: fixture.venue.id,
        tableSessionId: session.id,
        guestId: guest.id,
        idempotencyKey: randomUUID(),
        totalMinor: 1_200,
        statusEvents: {
          create: {
            tenantId: fixture.tenant.id,
            venueId: fixture.venue.id,
            status: "NEW",
            kind: "INITIAL",
          },
        },
        items: {
          create: {
            productId: fixture.product.id,
            productName: "Dish",
            quantity: 1,
            unitPriceMinor: 1_200,
            station: "KITCHEN",
          },
        },
      },
    });
    await prisma.staffShift.create({
      data: {
        tenantId: fixture.tenant.id,
        venueId: fixture.venue.id,
        userId: fixture.staff.userId,
        membershipId: fixture.staff.membershipId,
        activeShiftKey: `${fixture.venue.id}:${fixture.staff.userId}`,
      },
    });
    await staffOperationsRepository.transitionOrder({
      staff: fixture.staff,
      orderId: tableOrder.id,
      nextStatus: "ACCEPTED",
      expectedVersion: 1,
    });
    const online = await onlineOrderRepository.submit({
      publicSlug: fixture.publicSlug,
      locale: "en",
      idempotencyKey: randomUUID(),
      fulfillmentType: "PICKUP",
      contact: { name: "Guest", phone: "+49123" },
      requestedFor: new Date(Date.now() + 7_200_000),
      items: [{ productId: fixture.product.id, quantity: 1 }],
    });

    const orders = await operationalOrderRepository.listForStaff(fixture.staff);

    expect(orders).toHaveLength(2);
    expect(orders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "TABLE_GUEST_QR",
          fulfillment: "DINE_IN",
          status: "ACCEPTED",
          statusHistoryCoverage: "RECORDED_EVENTS",
        }),
        expect.objectContaining({
          reference: online.referenceCode,
          source: "ONLINE_PICKUP",
          fulfillment: "PICKUP",
          statusHistoryCoverage: "RECORDED_EVENTS",
        }),
      ]),
    );
    expect(
      orders.find((order) => order.reference === online.referenceCode)
        ?.customerLink,
    ).toEqual({ kind: "ORDER_CONTACT", id: null });
    expect(
      orders.find((order) => order.id === tableOrder.id)?.statusHistory,
    ).toEqual([
      expect.objectContaining({ status: "PENDING_CONFIRMATION", actor: null }),
      expect.objectContaining({
        status: "ACCEPTED",
        actor: {
          userId: fixture.staff.userId,
          membershipId: fixture.staff.membershipId,
        },
      }),
    ]);
    expect(
      await prisma.operationalOrderEvent.findMany({
        where: { tenantId: fixture.tenant.id },
        select: { orderKind: true, type: true, source: true, status: true },
        orderBy: { occurredAt: "asc" },
      }),
    ).toEqual(
      expect.arrayContaining([
        {
          orderKind: "TABLE",
          type: "ORDER_STATUS_CHANGED",
          source: "TABLE_GUEST_QR",
          status: "ACCEPTED",
        },
        {
          orderKind: "ONLINE",
          type: "ORDER_CREATED",
          source: "ONLINE_PICKUP",
          status: "PENDING_CONFIRMATION",
        },
      ]),
    );
  });
});
