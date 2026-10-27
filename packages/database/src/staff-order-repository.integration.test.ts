import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "./client.js";
import { staffOperationsRepository } from "./staff-operations-repository.js";
import {
  staffOrderRepository,
  StaffTableNotFoundError,
} from "./staff-order-repository.js";
import { ActiveShiftRequiredError } from "./staff-work-repository.js";
import { ProductUnavailableError } from "./order-item-resolution.js";
import { StaffPermissionDeniedError } from "@flowgastronomie/domain";
import type { StaffIdentity } from "./staff-auth-repository.js";
import { pilotOperationsRepository as pilot } from "./pilot-operations-repository.js";
import { staffProductionRepository } from "./staff-production-repository.js";
import { reservationRepository } from "./reservation-repository.js";

const tenantIds = new Set<string>();

async function createBaseFixture(role: "MANAGER" | "WAITER" | "KITCHEN") {
  const unique = randomUUID();
  const tenant = await prisma.tenant.create({
    data: { name: `POS ${unique}`, slug: `pos-${unique}` },
  });
  tenantIds.add(tenant.id);
  const venue = await prisma.venue.create({
    data: {
      tenantId: tenant.id,
      name: "POS venue",
      slug: `pos-venue-${unique}`,
      defaultLocale: "EN",
      timezone: "Europe/Berlin",
      currency: "EUR",
    },
  });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `${unique}@pos.integration.test`,
      displayName: "POS staff",
      passwordHash: "not-used",
    },
  });
  const membership = await prisma.membership.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      userId: user.id,
      role,
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
    role,
  };
  return { tenant, venue, user, membership, staff, unique };
}

async function createShift(
  tenantId: string,
  venueId: string,
  user: { id: string },
  membership: { id: string },
) {
  return prisma.staffShift.create({
    data: {
      tenantId,
      venueId,
      userId: user.id,
      membershipId: membership.id,
      activeShiftKey: `${venueId}:${user.id}`,
      status: "OPEN",
    },
  });
}

async function createMenu(tenantId: string, venueId: string) {
  const category = await prisma.menuCategory.create({
    data: {
      tenantId,
      venueId,
      published: true,
      translations: {
        create: { tenantId, venueId, locale: "EN", name: "Pizza" },
      },
    },
  });
  const product = await prisma.product.create({
    data: {
      tenantId,
      venueId,
      categoryId: category.id,
      priceMinor: 900,
      published: true,
      available: true,
      station: "KITCHEN",
      translations: {
        create: { tenantId, venueId, locale: "EN", name: "Margherita" },
      },
      variants: {
        create: {
          tenantId,
          venueId,
          priceDeltaMinor: 200,
          isDefault: true,
          translations: {
            create: [{ locale: "EN", name: "Regular" }],
          },
        },
      },
      modifierGroups: {
        create: {
          tenantId,
          venueId,
          minSelect: 0,
          maxSelect: 2,
          translations: {
            create: { locale: "EN", name: "Extras" },
          },
          options: {
            create: {
              tenantId,
              venueId,
              priceDeltaMinor: 150,
              translations: {
                create: { locale: "EN", name: "Extra cheese" },
              },
            },
          },
        },
      },
    },
  });
  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { productId: product.id },
  });
  const group = await prisma.productModifierGroup.findFirstOrThrow({
    where: { productId: product.id },
  });
  const option = await prisma.productModifierOption.findFirstOrThrow({
    where: { groupId: group.id },
  });
  return { category, product, variant, option };
}

async function createTable(tenantId: string, venueId: string, label: string) {
  return prisma.diningTable.create({
    data: {
      tenantId,
      venueId,
      label,
      qrTokenHash: `hash-${tenantId}-${label}`,
    },
  });
}

describe.sequential("staff order repository with PostgreSQL", () => {
  it("reads POS takeaway and dine-in tickets with immutable pizza details and tenant/station isolation", async () => {
    const f = await createBaseFixture("MANAGER");
    const other = await createBaseFixture("MANAGER");
    await createShift(f.tenant.id, f.venue.id, f.user, f.membership);
    const menu = await createMenu(f.tenant.id, f.venue.id);
    const table = await createTable(f.tenant.id, f.venue.id, "03");
    const takeaway = await staffOrderRepository.createOrder({
      staff: f.staff,
      orderType: "TAKEAWAY",
      locale: "en",
      idempotencyKey: "pilot-takeaway",
      items: [
        {
          productId: menu.product.id,
          quantity: 2,
          variantId: menu.variant.id,
          modifierOptionIds: [menu.option.id],
          notes: "Bake well",
        },
      ],
    });
    const dineIn = await staffOrderRepository.createOrder({
      staff: f.staff,
      orderType: "DINE_IN",
      tableId: table.id,
      locale: "en",
      idempotencyKey: "pilot-table",
      items: [{ productId: menu.product.id, quantity: 1 }],
    });
    await prisma.productTranslation.updateMany({
      where: { productId: menu.product.id },
      data: { name: "Changed live menu" },
    });
    const tickets = await pilot.production(f.staff, "KITCHEN");
    expect(tickets).toHaveLength(2);
    expect(tickets.find((t) => t.orderId === takeaway.id)).toMatchObject({
      reference: takeaway.id.slice(-8).toUpperCase(),
      orderType: "TAKEAWAY",
      items: [
        {
          quantity: 2,
          productName: "Margherita",
          variantName: "Regular",
          modifiers: [{ optionName: "Extra cheese" }],
          notes: "Bake well",
        },
      ],
    });
    expect(tickets.find((t) => t.orderId === dineIn.id)).toMatchObject({
      orderType: "DINE_IN",
      tableLabel: "03",
    });
    expect(await pilot.production(f.staff, "BAR")).toEqual([]);
    expect(await pilot.production(other.staff, "KITCHEN")).toEqual([]);
    expect(await pilot.counter(other.staff)).toEqual([]);
    await expect(pilot.complete(other.staff, takeaway.id)).rejects.toThrow();
    await expect(
      pilot.production({ ...f.staff, role: "KITCHEN" }, "BAR"),
    ).rejects.toBeInstanceOf(StaffPermissionDeniedError);
  });
  it("keeps QR tickets visible without a counter order and reuses valid ticket transitions", async () => {
    const f = await createBaseFixture("MANAGER");
    await createShift(f.tenant.id, f.venue.id, f.user, f.membership);
    const menu = await createMenu(f.tenant.id, f.venue.id);
    const table = await createTable(f.tenant.id, f.venue.id, "02");
    const session = await prisma.tableSession.create({
      data: {
        tenantId: f.tenant.id,
        venueId: f.venue.id,
        tableId: table.id,
        activeTableKey: table.id,
      },
    });
    const qr = await prisma.order.create({
      data: {
        tenantId: f.tenant.id,
        venueId: f.venue.id,
        tableSessionId: session.id,
        source: "GUEST_QR",
        status: "NEW",
        idempotencyKey: "pilot-qr",
        totalMinor: 900,
        currency: "EUR",
        items: {
          create: {
            productId: menu.product.id,
            productName: "QR pizza",
            quantity: 1,
            unitPriceMinor: 900,
            station: "KITCHEN",
          },
        },
        productionTickets: {
          create: {
            tenantId: f.tenant.id,
            venueId: f.venue.id,
            station: "KITCHEN",
          },
        },
      },
    });
    const ticket = (await pilot.production(f.staff, "KITCHEN"))[0]!;
    expect(ticket.orderId).toBe(qr.id);
    expect(ticket).toMatchObject({ orderType: "DINE_IN", tableLabel: "02" });
    expect(await pilot.counter(f.staff)).toEqual([]);
    await staffProductionRepository.transition({
      staff: f.staff,
      ticketId: ticket.id,
      status: "PREPARING",
      expectedVersion: 1,
    });
    await staffProductionRepository.transition({
      staff: f.staff,
      ticketId: ticket.id,
      status: "READY",
      expectedVersion: 2,
    });
    expect((await pilot.production(f.staff, "KITCHEN"))[0]?.status).toBe(
      "READY",
    );
    await staffProductionRepository.transition({
      staff: f.staff,
      ticketId: ticket.id,
      status: "SERVED",
      expectedVersion: 3,
    });
    expect(await pilot.production(f.staff, "KITCHEN")).toEqual([]);
  });
  it("loads isolated reservation settings using the actual Venue identifier", async () => {
    const f = await createBaseFixture("MANAGER");
    const other = await createBaseFixture("MANAGER");
    await prisma.venue.update({
      where: { id: f.venue.id },
      data: { reservationAutoConfirm: true },
    });
    expect(await reservationRepository.getAutoConfirm(f.staff)).toEqual({
      enabled: true,
    });
    expect(await reservationRepository.getAutoConfirm(other.staff)).toEqual({
      enabled: false,
    });
  });
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
    await prisma.auditEvent.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.staffShift.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tableGuest.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tableSession.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.diningTable.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
    tenantIds.clear();
  });

  afterAll(async () => prisma.$disconnect());

  it("creates an accepted dine-in POS order with server-owned prices and attribution", async () => {
    const fixture = await createBaseFixture("WAITER");
    await createShift(
      fixture.tenant.id,
      fixture.venue.id,
      fixture.user,
      fixture.membership,
    );
    const table = await createTable(fixture.tenant.id, fixture.venue.id, "07");
    const menu = await createMenu(fixture.tenant.id, fixture.venue.id);

    const order = await staffOrderRepository.createOrder({
      staff: fixture.staff,
      orderType: "DINE_IN",
      tableId: table.id,
      locale: "en",
      idempotencyKey: "pos-key-1",
      items: [
        {
          productId: menu.product.id,
          quantity: 2,
          variantId: menu.variant.id,
          modifierOptionIds: [menu.option.id],
        },
      ],
    });

    // Server-side price: (900 base + 200 variant + 150 option) x 2.
    expect(order.totalMinor).toBe(2_500);
    expect(order).toMatchObject({
      status: "ACCEPTED",
      orderType: "DINE_IN",
      source: "STAFF_TABLET",
      tableId: table.id,
      tableLabel: "07",
      currency: "EUR",
    });
    expect(order.items[0]).toMatchObject({
      productName: "Margherita",
      unitPriceMinor: 1_250,
      variantName: "Regular",
      modifiers: [{ optionName: "Extra cheese", priceDeltaMinor: 150 }],
    });

    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { statusEvents: true, productionTickets: true },
    });
    expect(stored.tableSessionId).toBeTruthy();
    expect(stored.guestId).toBeNull();
    expect(stored.createdByMembershipId).toBe(fixture.membership.id);
    expect(stored.createdByShiftId).toBeTruthy();
    expect(stored.serviceOwnerUserId).toBe(fixture.user.id);
    expect(stored.statusEvents).toHaveLength(1);
    expect(stored.statusEvents[0]).toMatchObject({
      status: "ACCEPTED",
      kind: "INITIAL",
      actorMembershipId: fixture.membership.id,
    });
    expect(stored.productionTickets).toHaveLength(1);
    expect(stored.productionTickets[0]).toMatchObject({ station: "KITCHEN" });

    const event = await prisma.operationalOrderEvent.findFirstOrThrow({
      where: { orderId: order.id, type: "ORDER_CREATED" },
    });
    expect(event).toMatchObject({
      orderKind: "TABLE",
      source: "TABLE_STAFF_TABLET",
      fulfillment: "DINE_IN",
      status: "ACCEPTED",
      totalMinor: 2_500,
      actorMembershipId: fixture.membership.id,
    });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: order.id, action: "STAFF_ORDER_CREATED" },
    });
    expect(audit).toMatchObject({ entityType: "Order" });

    // The dine-in POS order belongs to the table's open session, so the
    // existing close-session and payment flows see it.
    const session = await prisma.tableSession.findUniqueOrThrow({
      where: { activeTableKey: table.id },
      include: { orders: { select: { id: true } } },
    });
    expect(session.status).toBe("OPEN");
    expect(session.orders.map((entry) => entry.id)).toContain(order.id);
  });

  it("creates a takeaway POS order without any table session", async () => {
    const fixture = await createBaseFixture("WAITER");
    await createShift(
      fixture.tenant.id,
      fixture.venue.id,
      fixture.user,
      fixture.membership,
    );
    const menu = await createMenu(fixture.tenant.id, fixture.venue.id);

    const order = await staffOrderRepository.createOrder({
      staff: fixture.staff,
      orderType: "TAKEAWAY",
      locale: "en",
      idempotencyKey: "pos-key-2",
      items: [{ productId: menu.product.id, quantity: 1 }],
    });

    expect(order).toMatchObject({
      orderType: "TAKEAWAY",
      tableId: null,
      tableLabel: null,
      status: "ACCEPTED",
    });
    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(stored.tableSessionId).toBeNull();
    expect(stored.guestId).toBeNull();
    expect(stored.tableId).toBeNull();

    const event = await prisma.operationalOrderEvent.findFirstOrThrow({
      where: { orderId: order.id, type: "ORDER_CREATED" },
    });
    expect(event).toMatchObject({ fulfillment: "PICKUP" });
  });

  it("returns the same order when the same idempotency key repeats", async () => {
    const fixture = await createBaseFixture("WAITER");
    await createShift(
      fixture.tenant.id,
      fixture.venue.id,
      fixture.user,
      fixture.membership,
    );
    const menu = await createMenu(fixture.tenant.id, fixture.venue.id);
    const input = {
      staff: fixture.staff,
      orderType: "TAKEAWAY" as const,
      locale: "en" as const,
      idempotencyKey: "pos-key-3",
      items: [{ productId: menu.product.id, quantity: 1 }],
    };

    const first = await staffOrderRepository.createOrder(input);
    const second = await staffOrderRepository.createOrder(input);

    expect(second.id).toBe(first.id);
    expect(
      await prisma.order.count({ where: { tenantId: fixture.tenant.id } }),
    ).toBe(1);
  });

  it("rejects dine-in POS orders for unknown or foreign-venue tables", async () => {
    const fixture = await createBaseFixture("WAITER");
    await createShift(
      fixture.tenant.id,
      fixture.venue.id,
      fixture.user,
      fixture.membership,
    );
    await createMenu(fixture.tenant.id, fixture.venue.id);
    const otherFixture = await createBaseFixture("WAITER");
    await createShift(
      otherFixture.tenant.id,
      otherFixture.venue.id,
      otherFixture.user,
      otherFixture.membership,
    );
    const otherTable = await createTable(
      otherFixture.tenant.id,
      otherFixture.venue.id,
      "other",
    );

    await expect(
      staffOrderRepository.createOrder({
        staff: fixture.staff,
        orderType: "DINE_IN",
        tableId: "does-not-exist",
        locale: "en",
        idempotencyKey: "pos-key-4",
        items: [{ productId: "any", quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(StaffTableNotFoundError);

    await expect(
      staffOrderRepository.createOrder({
        staff: fixture.staff,
        orderType: "DINE_IN",
        tableId: otherTable.id,
        locale: "en",
        idempotencyKey: "pos-key-5",
        items: [{ productId: "any", quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(StaffTableNotFoundError);
  });

  it("isolates products by tenant and rejects unavailable or invalid selections", async () => {
    const fixture = await createBaseFixture("WAITER");
    await createShift(
      fixture.tenant.id,
      fixture.venue.id,
      fixture.user,
      fixture.membership,
    );
    const menu = await createMenu(fixture.tenant.id, fixture.venue.id);
    const otherFixture = await createBaseFixture("WAITER");
    await createShift(
      otherFixture.tenant.id,
      otherFixture.venue.id,
      otherFixture.user,
      otherFixture.membership,
    );
    const otherMenu = await createMenu(
      otherFixture.tenant.id,
      otherFixture.venue.id,
    );

    await expect(
      staffOrderRepository.createOrder({
        staff: fixture.staff,
        orderType: "TAKEAWAY",
        locale: "en",
        idempotencyKey: "pos-key-6",
        items: [{ productId: otherMenu.product.id, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ProductUnavailableError);

    await expect(
      staffOrderRepository.createOrder({
        staff: fixture.staff,
        orderType: "TAKEAWAY",
        locale: "en",
        idempotencyKey: "pos-key-7",
        items: [{ productId: "missing-product", quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ProductUnavailableError);

    await expect(
      staffOrderRepository.createOrder({
        staff: fixture.staff,
        orderType: "TAKEAWAY",
        locale: "en",
        idempotencyKey: "pos-key-8",
        items: [
          {
            productId: menu.product.id,
            quantity: 1,
            modifierOptionIds: ["unknown-option"],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ProductUnavailableError);
  });

  it("keeps POS order creation away from production roles and shiftless staff", async () => {
    const kitchen = await createBaseFixture("KITCHEN");
    await expect(
      staffOrderRepository.createOrder({
        staff: kitchen.staff,
        orderType: "TAKEAWAY",
        locale: "en",
        idempotencyKey: "pos-key-9",
        items: [{ productId: "any", quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(StaffPermissionDeniedError);

    const waiter = await createBaseFixture("WAITER");
    await expect(
      staffOrderRepository.createOrder({
        staff: waiter.staff,
        orderType: "TAKEAWAY",
        locale: "en",
        idempotencyKey: "pos-key-10",
        items: [{ productId: "any", quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ActiveShiftRequiredError);
  });

  it("moves POS takeaway orders through the existing kitchen transition flow", async () => {
    const fixture = await createBaseFixture("WAITER");
    await createShift(
      fixture.tenant.id,
      fixture.venue.id,
      fixture.user,
      fixture.membership,
    );
    const managerUser = await prisma.user.create({
      data: {
        tenantId: fixture.tenant.id,
        email: `manager-${fixture.unique}@pos.integration.test`,
        displayName: "POS manager",
        passwordHash: "not-used",
      },
    });
    const managerMembership = await prisma.membership.create({
      data: {
        tenantId: fixture.tenant.id,
        venueId: fixture.venue.id,
        userId: managerUser.id,
        role: "MANAGER",
      },
    });
    const managerShift = await createShift(
      fixture.tenant.id,
      fixture.venue.id,
      managerUser,
      managerMembership,
    );
    const menu = await createMenu(fixture.tenant.id, fixture.venue.id);

    const order = await staffOrderRepository.createOrder({
      staff: fixture.staff,
      orderType: "TAKEAWAY",
      locale: "en",
      idempotencyKey: "pos-key-11",
      items: [{ productId: menu.product.id, quantity: 1 }],
    });

    const transitioned = await staffOperationsRepository.transitionOrder({
      staff: {
        tenantId: fixture.tenant.id,
        venueId: fixture.venue.id,
        userId: managerUser.id,
        membershipId: managerMembership.id,
        role: "MANAGER",
      },
      orderId: order.id,
      nextStatus: "PREPARING",
      expectedVersion: 1,
    });
    expect(managerShift.status).toBe("OPEN");

    expect(transitioned).toMatchObject({ id: order.id, status: "PREPARING" });
    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(stored.status).toBe("PREPARING");
    expect(stored.version).toBe(2);
  });
});
