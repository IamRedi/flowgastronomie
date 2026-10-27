import { randomUUID } from "node:crypto";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { prisma } from "./client.js";
import { counterSaleRepository as sales } from "./counter-sale-repository.js";
import { pilotOperationsRepository as pilot } from "./pilot-operations-repository.js";
import {
  OnlineOrderDeliveryUnavailableError,
  OnlineOrderNotFoundError,
  OnlineOrderProductError,
  OnlineOrderTrackingNotFoundError,
  onlineOrderRepository,
} from "./online-order-repository.js";
import type { StaffIdentity } from "./staff-auth-repository.js";
import { ActiveShiftRequiredError } from "./staff-work-repository.js";

const openingHours = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
].map((day) => ({ day, closed: false, opensAt: "00:00", closesAt: "23:59" }));

const tenantIds = new Set<string>();

async function createOnlineOrderingFixture() {
  const unique = randomUUID();
  const tenant = await prisma.tenant.create({
    data: { name: `Integration ${unique}`, slug: `integration-${unique}` },
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
      name: `Venue ${unique}`,
      slug: `venue-${unique}`,
      defaultLocale: "EN",
      timezone: "Europe/Berlin",
      currency: "EUR",
      pickupLeadMinutes: 20,
    },
  });
  const publicSlug = `public-${unique}`;
  await prisma.venueWebsite.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      publicSlug,
      status: "PUBLISHED",
      openingHours,
      publishedAt: new Date(),
    },
  });
  const category = await prisma.menuCategory.create({
    data: { tenantId: tenant.id, venueId: venue.id, published: true },
  });
  const product = await prisma.product.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      categoryId: category.id,
      priceMinor: 1_200,
      currency: "EUR",
      available: true,
      published: true,
      station: "KITCHEN",
      translations: {
        create: {
          tenantId: tenant.id,
          venueId: venue.id,
          locale: "EN",
          name: "Integration dish",
        },
      },
    },
  });

  return { tenant, venue, category, product, publicSlug };
}

type OnlineOrderingFixture = Awaited<
  ReturnType<typeof createOnlineOrderingFixture>
>;

async function createProductForFixture(
  fixture: OnlineOrderingFixture,
  station: "BAR" | "KITCHEN" | "DESSERT",
) {
  const unique = randomUUID();
  return prisma.product.create({
    data: {
      tenantId: fixture.tenant.id,
      venueId: fixture.venue.id,
      categoryId: fixture.category.id,
      priceMinor: 500,
      currency: "EUR",
      available: true,
      published: true,
      station,
      translations: {
        create: {
          tenantId: fixture.tenant.id,
          venueId: fixture.venue.id,
          locale: "EN",
          name: `${station} item ${unique}`,
        },
      },
    },
  });
}

async function createStaff(
  fixture: OnlineOrderingFixture,
  role: StaffIdentity["role"],
  withActiveShift = true,
) {
  const unique = randomUUID();
  const user = await prisma.user.create({
    data: {
      tenantId: fixture.tenant.id,
      email: `${unique}@integration.test`,
      displayName: `${role} integration`,
      passwordHash: "not-used-by-repository-tests",
    },
  });
  const membership = await prisma.membership.create({
    data: {
      tenantId: fixture.tenant.id,
      venueId: fixture.venue.id,
      userId: user.id,
      role,
    },
  });
  const shift = withActiveShift
    ? await prisma.staffShift.create({
        data: {
          tenantId: fixture.tenant.id,
          venueId: fixture.venue.id,
          userId: user.id,
          membershipId: membership.id,
          activeShiftKey: `${fixture.venue.id}:${user.id}`,
        },
      })
    : null;
  const staff: StaffIdentity = {
    sessionId: `integration-${unique}`,
    userId: user.id,
    membershipId: membership.id,
    displayName: user.displayName,
    email: user.email,
    tenantId: fixture.tenant.id,
    tenantSlug: fixture.tenant.slug,
    venueId: fixture.venue.id,
    venueName: fixture.venue.name,
    venueSlug: fixture.venue.slug,
    role,
  };
  return { staff, shift };
}

function deliveryInput(
  fixture: OnlineOrderingFixture,
  overrides: {
    idempotencyKey?: string;
    productId?: string;
    postalCode?: string;
  } = {},
) {
  return {
    publicSlug: fixture.publicSlug,
    locale: "en" as const,
    idempotencyKey: overrides.idempotencyKey ?? randomUUID(),
    fulfillmentType: "DELIVERY" as const,
    contact: { name: "Integration Guest", phone: "+49 30 123456" },
    requestedFor: new Date(Date.now() + 7_200_000),
    deliveryAddress: {
      line1: "Teststrasse 1",
      postalCode: overrides.postalCode ?? "10115",
      city: "Berlin",
    },
    items: [
      {
        productId: overrides.productId ?? fixture.product.id,
        quantity: 1,
      },
    ],
  };
}

function pickupInput(
  fixture: OnlineOrderingFixture,
  productIds: string[] = [fixture.product.id],
) {
  return {
    publicSlug: fixture.publicSlug,
    locale: "en" as const,
    idempotencyKey: randomUUID(),
    fulfillmentType: "PICKUP" as const,
    timingMode: "ASAP" as const,
    contact: { name: "Integration Guest", phone: "+49 30 123456" },
    requestedFor: new Date(Date.now() + 7_200_000),
    items: productIds.map((productId) => ({ productId, quantity: 1 })),
  };
}

describe.sequential("online order repository with PostgreSQL", () => {
  it("public status is scoped and minimal, reflects persisted state and grants no private access", async () => {
    const fixture = await createOnlineOrderingFixture();
    const other = await createOnlineOrderingFixture();
    const created = await onlineOrderRepository.submit(pickupInput(fixture));
    const before = await prisma.onlineOrder.findUniqueOrThrow({
      where: { referenceCode: created.referenceCode },
    });
    await prisma.onlineOrderMessage.create({
      data: {
        onlineOrderId: before.id,
        author: "GUEST",
        body: "Private message",
      },
    });
    const sessions = await prisma.onlineOrderRecoverySession.count();
    const input = {
      publicSlug: fixture.publicSlug,
      referenceCode: created.referenceCode.toLowerCase(),
    };
    expect(await onlineOrderRepository.findPublicStatus(input)).toEqual({
      status: "PENDING_CONFIRMATION",
      requestedFor: before.requestedFor.toISOString(),
      venue: { name: fixture.venue.name, timezone: fixture.venue.timezone },
    });
    expect(
      await prisma.onlineOrder.findUniqueOrThrow({ where: { id: before.id } }),
    ).toEqual(before);
    expect(await prisma.onlineOrderRecoverySession.count()).toBe(sessions);
    for (const publicSlug of [other.publicSlug, "unknown-venue"]) {
      await expect(
        onlineOrderRepository.findPublicStatus({ ...input, publicSlug }),
      ).rejects.toBeInstanceOf(OnlineOrderTrackingNotFoundError);
    }
    await expect(
      onlineOrderRepository.findTracking(created.referenceCode),
    ).rejects.toBeInstanceOf(OnlineOrderTrackingNotFoundError);
    const privateOrder = await onlineOrderRepository.findTracking(
      created.trackingToken!,
    );
    expect(privateOrder.contact.phone).toBe("+49 30 123456");
    expect(privateOrder.items).toHaveLength(1);
    expect(privateOrder.messages[0]?.body).toBe("Private message");
    // A fixture update proves this projection reads the existing lifecycle.
    await prisma.onlineOrder.update({
      where: { id: before.id },
      data: { status: "READY" },
    });
    expect((await onlineOrderRepository.findPublicStatus(input)).status).toBe(
      "READY",
    );
    await prisma.venueWebsite.update({
      where: { publicSlug: fixture.publicSlug },
      data: { status: "DRAFT" },
    });
    await expect(
      onlineOrderRepository.findPublicStatus(input),
    ).rejects.toBeInstanceOf(OnlineOrderTrackingNotFoundError);
    await prisma.venueWebsite.update({
      where: { publicSlug: fixture.publicSlug },
      data: { status: "PUBLISHED" },
    });
    await prisma.onlineOrder.update({
      where: { id: before.id },
      data: { personalDataRedactedAt: new Date() },
    });
    await expect(
      onlineOrderRepository.findPublicStatus(input),
    ).rejects.toBeInstanceOf(OnlineOrderTrackingNotFoundError);
  });
  it("ASAP uses server time and lead, stays pending and supports secure short-lived recovery", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T16:00:00Z"));
    const fixture = await createOnlineOrderingFixture();
    await prisma.venue.update({
      where: { id: fixture.venue.id },
      data: { pickupLeadMinutes: 20 },
    });
    const available = await onlineOrderRepository.pickupAvailability(
      fixture.publicSlug,
    );
    expect(available.earliest).toEqual(new Date("2026-10-06T16:20:00Z"));
    expect(available.slots[0]?.at).toEqual(new Date("2026-10-06T16:30:00Z"));
    const input = {
      ...pickupInput(fixture),
      timingMode: "ASAP" as const,
      requestedFor: new Date(0),
    };
    const submitted = await onlineOrderRepository.submit(input);
    const order = await prisma.onlineOrder.findUniqueOrThrow({
      where: { referenceCode: submitted.referenceCode },
      include: { productionTickets: true },
    });
    expect(order).toMatchObject({
      status: "PENDING_CONFIRMATION",
      requestedFor: new Date("2026-10-06T16:20:00Z"),
      productionNotBefore: new Date("2026-10-06T16:00:00Z"),
      productionTickets: [],
    });
    vi.setSystemTime(new Date("2026-10-06T16:10:00Z"));
    expect((await onlineOrderRepository.submit(input)).referenceCode).toBe(
      order.referenceCode,
    );
    expect(
      await prisma.onlineOrder.count({ where: { venueId: fixture.venue.id } }),
    ).toBe(1);
    for (const phone of ["+49 30 999999", "123456"])
      await expect(
        onlineOrderRepository.recover({
          publicSlug: fixture.publicSlug,
          referenceCode: order.referenceCode,
          phone,
        }),
      ).rejects.toBeInstanceOf(OnlineOrderTrackingNotFoundError);
    const another = await createOnlineOrderingFixture();
    await expect(
      onlineOrderRepository.recover({
        publicSlug: another.publicSlug,
        referenceCode: order.referenceCode,
        phone: input.contact.phone,
      }),
    ).rejects.toBeInstanceOf(OnlineOrderTrackingNotFoundError);
    await expect(
      onlineOrderRepository.findTracking(order.referenceCode),
    ).rejects.toBeInstanceOf(OnlineOrderTrackingNotFoundError);
    const recovered = await onlineOrderRepository.recover({
      publicSlug: fixture.publicSlug,
      referenceCode: order.referenceCode.toLowerCase(),
      phone: "0049 (30) 123-456",
    });
    expect(
      (await onlineOrderRepository.findTracking(recovered.sessionToken))
        .referenceCode,
    ).toBe(order.referenceCode);
    const session = await prisma.onlineOrderRecoverySession.findFirstOrThrow({
      where: { onlineOrderId: order.id },
    });
    expect(session.tokenHash).not.toBe(recovered.sessionToken);
    expect(session).toMatchObject({
      tenantId: fixture.tenant.id,
      venueId: fixture.venue.id,
    });
    vi.setSystemTime(new Date("2026-10-06T16:40:01Z"));
    await expect(
      onlineOrderRepository.findTracking(recovered.sessionToken),
    ).rejects.toBeInstanceOf(OnlineOrderTrackingNotFoundError);
    expect(
      (await onlineOrderRepository.findTracking(submitted.trackingToken!))
        .referenceCode,
    ).toBe(order.referenceCode);
  });

  it("closed venue resolves the next opening plus lead in its own timezone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T20:50:00Z"));
    const fixture = await createOnlineOrderingFixture();
    await prisma.venue.update({
      where: { id: fixture.venue.id },
      data: { pickupLeadMinutes: 20 },
    });
    await prisma.venueWebsite.update({
      where: { venueId: fixture.venue.id },
      data: {
        openingHours: openingHours.map((h) => ({
          ...h,
          closed: h.day === "MONDAY",
          opensAt: "17:00",
          closesAt: "22:00",
        })),
      },
    });
    const result = await onlineOrderRepository.submit({
      ...pickupInput(fixture),
      timingMode: "ASAP",
      requestedFor: undefined,
    });
    expect(
      (await onlineOrderRepository.findTracking(result.trackingToken!))
        .requestedFor,
    ).toEqual(new Date("2026-10-06T15:20:00Z"));
    await expect(
      onlineOrderRepository.submit({
        ...pickupInput(fixture),
        timingMode: "SCHEDULED",
        requestedFor: new Date("2026-10-06T14:30:00Z"),
      }),
    ).rejects.toMatchObject({
      availability: { earliest: new Date("2026-10-06T15:20:00Z") },
    });
  });

  it("future accepted pickup is absent from Kitchen and cannot prepare until its persisted window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T16:00:00Z"));
    const fixture = await createOnlineOrderingFixture();
    await prisma.venue.update({
      where: { id: fixture.venue.id },
      data: { pickupLeadMinutes: 20 },
    });
    const { staff } = await createStaff(fixture, "MANAGER");
    const result = await onlineOrderRepository.submit({
      ...pickupInput(fixture),
      timingMode: "SCHEDULED",
      requestedFor: new Date("2026-10-07T16:00:00Z"),
    });
    expect(
      (await onlineOrderRepository.findTracking(result.trackingToken!)).status,
    ).toBe("PENDING_CONFIRMATION");
    await onlineOrderRepository.transitionForStaff({
      staff,
      orderId: result.referenceCode,
      status: "ACCEPTED",
    });
    const order = await prisma.onlineOrder.findUniqueOrThrow({
      where: { referenceCode: result.referenceCode },
      include: { productionTickets: true },
    });
    const ticket = order.productionTickets[0]!;
    expect(
      await onlineOrderRepository.listProductionForStaff({
        staff,
        station: "KITCHEN",
      }),
    ).toEqual([]);
    await expect(
      onlineOrderRepository.transitionForStaff({
        staff,
        orderId: order.id,
        status: "PREPARING",
      }),
    ).rejects.toBeInstanceOf(OnlineOrderProductError);
    await expect(
      onlineOrderRepository.transitionProductionForStaff({
        staff,
        ticketId: ticket.id,
        status: "PREPARING",
        expectedVersion: ticket.version,
      }),
    ).rejects.toBeInstanceOf(OnlineOrderProductError);
    vi.setSystemTime(new Date("2026-10-07T15:40:00Z"));
    expect(
      await onlineOrderRepository.listProductionForStaff({
        staff,
        station: "KITCHEN",
      }),
    ).toHaveLength(1);
    await onlineOrderRepository.transitionProductionForStaff({
      staff,
      ticketId: ticket.id,
      status: "PREPARING",
      expectedVersion: ticket.version,
    });
    await onlineOrderRepository.transitionForStaff({
      staff,
      orderId: order.id,
      status: "CANCELLED",
    });
    expect(
      await onlineOrderRepository.listProductionForStaff({
        staff,
        station: "KITCHEN",
      }),
    ).toEqual([]);
    expect(
      await prisma.onlineOrderStationTicket.count({
        where: { onlineOrderId: order.id },
      }),
    ).toBe(1);
  });

  it("ASAP persists venue-local date across a UTC business-day boundary", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T18:20:00Z"));
    const fixture = await createOnlineOrderingFixture();
    await prisma.venue.update({
      where: { id: fixture.venue.id },
      data: { timezone: "Asia/Kathmandu" },
    });
    const options = await onlineOrderRepository.pickupAvailability(
      fixture.publicSlug,
    );
    expect(options.slots[0]).toEqual({
      at: new Date("2026-10-05T18:45:00Z"),
      day: "2026-10-06",
      label: "00:30",
    });
    const result = await onlineOrderRepository.submit({
      ...pickupInput(fixture),
      requestedFor: undefined,
    });
    expect(
      (await onlineOrderRepository.findTracking(result.trackingToken!))
        .requestedFor,
    ).toEqual(new Date("2026-10-05T18:40:00Z"));
  });
  it("unconfigured venue cannot invent ASAP availability", async () => {
    const fixture = await createOnlineOrderingFixture();
    await prisma.venue.update({
      where: { id: fixture.venue.id },
      data: { pickupLeadMinutes: null },
    });
    expect(
      await onlineOrderRepository.pickupAvailability(fixture.publicSlug),
    ).toMatchObject({
      earliest: null,
      slots: [],
      unavailableReason: "NOT_CONFIGURED",
    });
    await expect(
      onlineOrderRepository.submit({
        ...pickupInput(fixture),
        timingMode: "ASAP",
        requestedFor: undefined,
      }),
    ).rejects.toMatchObject({
      availability: { unavailableReason: "NOT_CONFIGURED" },
    });
    expect(
      await prisma.onlineOrder.count({ where: { venueId: fixture.venue.id } }),
    ).toBe(0);
  });
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is required for database integration tests. See README.md.",
      );
    }
    await prisma.$connect();
  });

  afterEach(async () => {
    vi.useRealTimers();
    const ids = [...tenantIds];
    if (ids.length === 0) return;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL flowgastronomie.test_cleanup = 'on'`;
      const where = { tenantId: { in: ids } };
      await tx.operationalOrderEvent.deleteMany({ where });
      await tx.receipt.deleteMany({ where });
      await tx.paymentRecord.deleteMany({ where });
      await tx.cashSession.deleteMany({ where });
      await tx.onlineOrder.deleteMany({ where });
      await tx.staffShift.deleteMany({ where });
      await tx.product.updateMany({ where, data: { taxCategoryId: null } });
      await tx.tenant.deleteMany({ where: { id: { in: ids } } });
    });
    tenantIds.clear();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("takes a website pickup through accept, kitchen, cash/card and one receipt per order", async () => {
    const fixture = await createOnlineOrderingFixture();
    const manager = await createStaff(fixture, "MANAGER");
    await prisma.venue.update({
      where: { id: fixture.venue.id },
      data: { onlinePickupEnabled: true },
    });
    await prisma.organizationBillingProfile.create({
      data: {
        tenantId: fixture.tenant.id,
        legalName: "Test Pizza",
        billingEmail: "billing@example.test",
        addressLine1: "Test 1",
        postalCode: "10000",
        city: "Berlin",
        countryCode: "DE",
      },
    });
    await sales.configureTax(manager.staff, {
      code: "TEST_10",
      rateBasisPoints: 1000,
      productIds: [fixture.product.id],
    });
    await sales.open(manager.staff, 0);
    const first = await onlineOrderRepository.submit(pickupInput(fixture));
    const submitted = await prisma.onlineOrder.findUniqueOrThrow({
      where: { referenceCode: first.referenceCode },
      include: { items: true },
    });
    expect(submitted.items[0]?.taxSnapshot).toMatchObject({
      grossMinor: 1200,
      rateBasisPoints: 1000,
    });
    expect(
      (await pilot.orders(manager.staff)).find(
        (item) => item.id === submitted.id,
      ),
    ).toMatchObject({
      source: "WEBSITE",
      lifecycleStatus: "PENDING_CONFIRMATION",
      paymentStatus: "PENDING_PAYMENT",
    });
    await expect(
      sales.payOnline(manager.staff, {
        onlineOrderId: submitted.id,
        method: "CASH",
        receivedMinor: 2000,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "ORDER_NOT_READY" });
    await onlineOrderRepository.transitionForStaff({
      staff: manager.staff,
      orderId: first.referenceCode,
      status: "ACCEPTED",
    });
    const ticket = await prisma.onlineOrderStationTicket.findFirstOrThrow({
      where: { onlineOrderId: submitted.id },
    });
    await onlineOrderRepository.transitionProductionForStaff({
      staff: manager.staff,
      ticketId: ticket.id,
      status: "PREPARING",
      expectedVersion: 1,
    });
    await onlineOrderRepository.transitionProductionForStaff({
      staff: manager.staff,
      ticketId: ticket.id,
      status: "READY",
      expectedVersion: 2,
    });
    await expect(
      onlineOrderRepository.transitionForStaff({
        staff: manager.staff,
        orderId: first.referenceCode,
        status: "COMPLETED",
      }),
    ).rejects.toMatchObject({ code: "PICKUP_PAYMENT_REQUIRED" });
    const payment = {
      onlineOrderId: submitted.id,
      method: "CASH" as const,
      receivedMinor: 2000,
      idempotencyKey: randomUUID(),
    };
    const cashReceipt = await sales.payOnline(manager.staff, payment);
    expect(cashReceipt).toMatchObject({
      orderId: null,
      onlineOrderId: submitted.id,
      grossMinor: 1200,
    });
    expect((await sales.payOnline(manager.staff, payment)).id).toBe(
      cashReceipt.id,
    );
    await expect(
      sales.payOnline(manager.staff, {
        ...payment,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "ALREADY_PAID" });
    expect(
      (await pilot.orders(manager.staff)).find(
        (item) => item.id === submitted.id,
      ),
    ).toMatchObject({
      productionStatus: "READY",
      paymentStatus: "PAID",
      receiptId: cashReceipt.id,
    });
    await onlineOrderRepository.transitionForStaff({
      staff: manager.staff,
      orderId: first.referenceCode,
      status: "COMPLETED",
    });
    expect(
      (await pilot.orders(manager.staff)).some(
        (item) => item.id === submitted.id,
      ),
    ).toBe(false);
    const second = await onlineOrderRepository.submit(pickupInput(fixture));
    await onlineOrderRepository.transitionForStaff({
      staff: manager.staff,
      orderId: second.referenceCode,
      status: "ACCEPTED",
    });
    const secondOrder = await prisma.onlineOrder.findUniqueOrThrow({
      where: { referenceCode: second.referenceCode },
    });
    const secondTicket = await prisma.onlineOrderStationTicket.findFirstOrThrow(
      { where: { onlineOrderId: secondOrder.id } },
    );
    await onlineOrderRepository.transitionProductionForStaff({
      staff: manager.staff,
      ticketId: secondTicket.id,
      status: "PREPARING",
      expectedVersion: 1,
    });
    await onlineOrderRepository.transitionProductionForStaff({
      staff: manager.staff,
      ticketId: secondTicket.id,
      status: "READY",
      expectedVersion: 2,
    });
    const balanceBefore = (await sales.register(manager.staff)).session
      ?.expectedCashMinor;
    const cardReceipt = await sales.payOnline(manager.staff, {
      onlineOrderId: secondOrder.id,
      method: "CARD_AT_COUNTER",
      terminalConfirmed: true,
      idempotencyKey: randomUUID(),
    });
    expect(cardReceipt.number).not.toBe(cashReceipt.number);
    expect(
      (await sales.register(manager.staff)).session?.expectedCashMinor,
    ).toBe(balanceBefore);
    expect(
      await prisma.receipt.count({ where: { tenantId: fixture.tenant.id } }),
    ).toBe(2);
  });

  it("selects the most specific venue zone and snapshots its fee", async () => {
    const fixture = await createOnlineOrderingFixture();
    await prisma.deliveryZone.create({
      data: {
        tenantId: fixture.tenant.id,
        venueId: fixture.venue.id,
        name: "Berlin",
        postalPrefixes: ["10"],
        feeMinor: 350,
        minimumOrderMinor: 1_000,
      },
    });
    const specific = await prisma.deliveryZone.create({
      data: {
        tenantId: fixture.tenant.id,
        venueId: fixture.venue.id,
        name: "Berlin Mitte",
        postalPrefixes: ["10115"],
        feeMinor: 150,
        minimumOrderMinor: 1_000,
      },
    });
    const idempotencyKey = randomUUID();

    const first = await onlineOrderRepository.submit(
      deliveryInput(fixture, { idempotencyKey }),
    );
    const repeated = await onlineOrderRepository.submit(
      deliveryInput(fixture, { idempotencyKey }),
    );
    const persisted = await prisma.onlineOrder.findUniqueOrThrow({
      where: { referenceCode: first.referenceCode },
      include: { customerProfile: true },
    });

    expect(persisted.deliveryZoneId).toBe(specific.id);
    expect(persisted.deliveryFeeMinor).toBe(150);
    expect(persisted.totalMinor).toBe(1_350);
    expect(persisted.customerProfile).toMatchObject({
      tenantId: fixture.tenant.id,
      venueId: fixture.venue.id,
      displayName: "Integration Guest",
      emailNormalized: null,
      phoneNormalized: "+4930123456",
      preferredLocale: "EN",
    });
    expect(repeated).toEqual({
      referenceCode: first.referenceCode,
      trackingToken: null,
      status: "PENDING_CONFIRMATION",
    });
    expect(
      await prisma.onlineOrder.count({
        where: { tenantId: fixture.tenant.id, venueId: fixture.venue.id },
      }),
    ).toBe(1);

    await prisma.deliveryZone.update({
      where: { id: specific.id },
      data: { feeMinor: 900 },
    });
    const unchanged = await prisma.onlineOrder.findUniqueOrThrow({
      where: { id: persisted.id },
    });
    expect(unchanged.deliveryFeeMinor).toBe(150);
    expect(unchanged.totalMinor).toBe(1_350);
  });

  it("does not use a matching delivery zone owned by another tenant", async () => {
    const requestedVenue = await createOnlineOrderingFixture();
    const otherVenue = await createOnlineOrderingFixture();
    await prisma.deliveryZone.create({
      data: {
        tenantId: otherVenue.tenant.id,
        venueId: otherVenue.venue.id,
        name: "Other tenant zone",
        postalPrefixes: ["10115"],
        feeMinor: 100,
        minimumOrderMinor: 0,
      },
    });

    await expect(
      onlineOrderRepository.submit(deliveryInput(requestedVenue)),
    ).rejects.toBeInstanceOf(OnlineOrderDeliveryUnavailableError);
    expect(
      await prisma.onlineOrder.count({
        where: { tenantId: requestedVenue.tenant.id },
      }),
    ).toBe(0);
  });

  it("rejects products owned by another tenant", async () => {
    const requestedVenue = await createOnlineOrderingFixture();
    const otherVenue = await createOnlineOrderingFixture();
    await prisma.deliveryZone.create({
      data: {
        tenantId: requestedVenue.tenant.id,
        venueId: requestedVenue.venue.id,
        name: "Requested venue zone",
        postalPrefixes: ["10115"],
        feeMinor: 100,
        minimumOrderMinor: 0,
      },
    });

    await expect(
      onlineOrderRepository.submit(
        deliveryInput(requestedVenue, { productId: otherVenue.product.id }),
      ),
    ).rejects.toBeInstanceOf(OnlineOrderProductError);
  });

  it("rejects delivery below the venue zone minimum", async () => {
    const fixture = await createOnlineOrderingFixture();
    await prisma.deliveryZone.create({
      data: {
        tenantId: fixture.tenant.id,
        venueId: fixture.venue.id,
        name: "Minimum zone",
        postalPrefixes: ["10115"],
        feeMinor: 200,
        minimumOrderMinor: 1_500,
      },
    });

    await expect(
      onlineOrderRepository.submit(deliveryInput(fixture)),
    ).rejects.toBeInstanceOf(OnlineOrderDeliveryUnavailableError);
    expect(
      await prisma.onlineOrder.count({
        where: { tenantId: fixture.tenant.id },
      }),
    ).toBe(0);
  });

  it("routes a mixed order through station tickets and updates the parent atomically", async () => {
    const fixture = await createOnlineOrderingFixture();
    const barProduct = await createProductForFixture(fixture, "BAR");
    const owner = await createStaff(fixture, "OWNER");
    const kitchen = await createStaff(fixture, "KITCHEN");
    const bar = await createStaff(fixture, "BAR");
    const submitted = await onlineOrderRepository.submit(
      pickupInput(fixture, [fixture.product.id, barProduct.id]),
    );

    await onlineOrderRepository.transitionForStaff({
      staff: owner.staff,
      orderId: submitted.referenceCode,
      status: "ACCEPTED",
      note: "Accepted for integration production",
    });
    const order = await prisma.onlineOrder.findUniqueOrThrow({
      where: { referenceCode: submitted.referenceCode },
      include: { productionTickets: true },
    });
    expect(
      order.productionTickets.map((ticket) => ticket.station).sort(),
    ).toEqual(["BAR", "KITCHEN"]);

    const kitchenTicket = order.productionTickets.find(
      (ticket) => ticket.station === "KITCHEN",
    );
    const barTicket = order.productionTickets.find(
      (ticket) => ticket.station === "BAR",
    );
    expect(kitchenTicket).toBeDefined();
    expect(barTicket).toBeDefined();

    const preparationStarted =
      await onlineOrderRepository.transitionProductionForStaff({
        staff: kitchen.staff,
        ticketId: kitchenTicket!.id,
        status: "PREPARING",
        expectedVersion: 1,
      });
    expect(preparationStarted).toMatchObject({
      customerStatusChanged: true,
      order: { status: "PREPARING", locale: "en" },
    });
    const kitchenReady =
      await onlineOrderRepository.transitionProductionForStaff({
        staff: kitchen.staff,
        ticketId: kitchenTicket!.id,
        status: "READY",
        expectedVersion: 2,
      });
    expect(kitchenReady.customerStatusChanged).toBe(false);
    expect(
      (await prisma.onlineOrder.findUniqueOrThrow({ where: { id: order.id } }))
        .status,
    ).toBe("PREPARING");

    await onlineOrderRepository.transitionProductionForStaff({
      staff: bar.staff,
      ticketId: barTicket!.id,
      status: "PREPARING",
      expectedVersion: 1,
    });
    await expect(
      onlineOrderRepository.transitionProductionForStaff({
        staff: bar.staff,
        ticketId: barTicket!.id,
        status: "PREPARING",
        expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(OnlineOrderProductError);
    const productionReady =
      await onlineOrderRepository.transitionProductionForStaff({
        staff: bar.staff,
        ticketId: barTicket!.id,
        status: "READY",
        expectedVersion: 2,
      });
    expect(productionReady).toMatchObject({
      customerStatusChanged: true,
      order: { status: "READY", locale: "en" },
    });

    const completedProduction = await prisma.onlineOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        productionTickets: true,
        statusEvents: { orderBy: { createdAt: "asc" } },
      },
    });
    expect(completedProduction.status).toBe("READY");
    expect(
      completedProduction.productionTickets.map((ticket) => ({
        station: ticket.station,
        status: ticket.status,
        version: ticket.version,
      })),
    ).toEqual(
      expect.arrayContaining([
        { station: "KITCHEN", status: "READY", version: 3 },
        { station: "BAR", status: "READY", version: 3 },
      ]),
    );
    expect(
      completedProduction.statusEvents.map((event) => event.status),
    ).toEqual(["PENDING_CONFIRMATION", "ACCEPTED", "PREPARING", "READY"]);

    const productionAudits = await prisma.auditEvent.findMany({
      where: {
        tenantId: fixture.tenant.id,
        entityType: "OnlineOrderStationTicket",
      },
    });
    expect(productionAudits).toHaveLength(4);
    expect(productionAudits.every((event) => event.actorShiftId !== null)).toBe(
      true,
    );
    expect(
      await onlineOrderRepository.listProductionForStaff({
        staff: kitchen.staff,
        station: "KITCHEN",
      }),
    ).toMatchObject([{ items: [{ productName: "Integration dish" }] }]);
    expect(
      await onlineOrderRepository.listProductionForStaff({
        staff: bar.staff,
        station: "BAR",
      }),
    ).toMatchObject([
      { items: [{ productName: expect.stringContaining("BAR") }] },
    ]);
  });

  it("requires an active shift for online operational transitions", async () => {
    const fixture = await createOnlineOrderingFixture();
    const owner = await createStaff(fixture, "OWNER", false);
    const submitted = await onlineOrderRepository.submit(pickupInput(fixture));

    await expect(
      onlineOrderRepository.transitionForStaff({
        staff: owner.staff,
        orderId: submitted.referenceCode,
        status: "ACCEPTED",
      }),
    ).rejects.toBeInstanceOf(ActiveShiftRequiredError);

    const unchanged = await prisma.onlineOrder.findUniqueOrThrow({
      where: { referenceCode: submitted.referenceCode },
      include: { productionTickets: true },
    });
    expect(unchanged.status).toBe("PENDING_CONFIRMATION");
    expect(unchanged.productionTickets).toHaveLength(0);
  });

  it("does not expose or mutate another tenant's production ticket", async () => {
    const fixture = await createOnlineOrderingFixture();
    const otherFixture = await createOnlineOrderingFixture();
    const owner = await createStaff(fixture, "OWNER");
    const otherOwner = await createStaff(otherFixture, "OWNER");
    const submitted = await onlineOrderRepository.submit(pickupInput(fixture));
    await onlineOrderRepository.transitionForStaff({
      staff: owner.staff,
      orderId: submitted.referenceCode,
      status: "ACCEPTED",
    });
    const ticket = await prisma.onlineOrderStationTicket.findFirstOrThrow({
      where: { tenantId: fixture.tenant.id },
    });

    await expect(
      onlineOrderRepository.transitionProductionForStaff({
        staff: otherOwner.staff,
        ticketId: ticket.id,
        status: "PREPARING",
        expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(OnlineOrderNotFoundError);
    expect(
      await onlineOrderRepository.listProductionForStaff({
        staff: otherOwner.staff,
        station: "KITCHEN",
      }),
    ).toEqual([]);
    expect(
      (
        await prisma.onlineOrderStationTicket.findUniqueOrThrow({
          where: { id: ticket.id },
        })
      ).status,
    ).toBe("NEW");
  });
});
