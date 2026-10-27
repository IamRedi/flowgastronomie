import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "./client.js";
import {
  GuestSessionNotFoundError,
  guestServiceRepository,
  ProductUnavailableError,
} from "./guest-service-repository.js";
import { hashOpaqueToken, hashQrToken } from "./public-menu-repository.js";
import { trialRegistrationRepository } from "./trial-registration-repository.js";
import {
  venueLaunchRepository,
  VenueLaunchBlockedError,
} from "./venue-launch-repository.js";

const tenantIds = new Set<string>();
const retentionRunIds = new Set<string>();

async function createGuestFixture() {
  const unique = randomUUID();
  const qrToken = `qr-${unique}`;
  const tenant = await prisma.tenant.create({
    data: { name: `Guest ${unique}`, slug: `guest-${unique}` },
  });
  tenantIds.add(tenant.id);
  const venue = await prisma.venue.create({
    data: {
      tenantId: tenant.id,
      name: `Guest Venue ${unique}`,
      slug: `guest-venue-${unique}`,
      defaultLocale: "EN",
      defaultServiceMode: "MENU_ONLY",
      currency: "EUR",
    },
  });
  const area = await prisma.area.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      name: "Terrace",
      serviceModeOverride: "CALL_AND_REQUEST",
    },
  });
  const table = await prisma.diningTable.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      areaId: area.id,
      label: "T-07",
      qrTokenHash: hashQrToken(qrToken),
      serviceModeOverride: "ORDER_AND_CONFIRM",
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
      priceMinor: 1_450,
      currency: "EUR",
      published: true,
      available: true,
      station: "KITCHEN",
      translations: {
        create: [
          {
            tenantId: tenant.id,
            venueId: venue.id,
            locale: "EN",
            name: "Guest integration dish",
          },
          {
            tenantId: tenant.id,
            venueId: venue.id,
            locale: "DE",
            name: "Gast Integration Gericht",
          },
        ],
      },
    },
  });
  return { tenant, venue, table, product, qrToken };
}

async function completeLaunchPrerequisites(input: {
  tenantId: string;
  venueId: string;
}) {
  const unique = randomUUID();
  await prisma.organizationBillingProfile.create({
    data: {
      tenantId: input.tenantId,
      legalName: "Integration Restaurant GmbH",
      billingEmail: `${unique}@integration.test`,
      addressLine1: "Teststrasse 1",
      postalCode: "10115",
      city: "Berlin",
      countryCode: "DE",
    },
  });
  await prisma.venueWebsite.update({
    where: { venueId: input.venueId },
    data: { status: "PUBLISHED", publishedAt: new Date() },
  });
  const category = await prisma.menuCategory.create({
    data: {
      tenantId: input.tenantId,
      venueId: input.venueId,
      published: true,
    },
  });
  await prisma.product.create({
    data: {
      tenantId: input.tenantId,
      venueId: input.venueId,
      categoryId: category.id,
      priceMinor: 1_200,
      published: true,
      available: true,
      station: "KITCHEN",
    },
  });
  await prisma.diningTable.create({
    data: {
      tenantId: input.tenantId,
      venueId: input.venueId,
      label: "01",
      qrTokenHash: hashQrToken(`launch-qr-${unique}`),
    },
  });
  const teammate = await prisma.user.create({
    data: {
      tenantId: input.tenantId,
      email: `teammate-${unique}@integration.test`,
      displayName: "Integration teammate",
      passwordHash: "not-used-by-repository-tests",
    },
  });
  await prisma.membership.create({
    data: {
      tenantId: input.tenantId,
      venueId: input.venueId,
      userId: teammate.id,
      role: "WAITER",
    },
  });
  const retentionRun = await prisma.retentionRun.create({
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  retentionRunIds.add(retentionRun.id);
}

describe.sequential("core guest and owner journeys with PostgreSQL", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is required for database integration tests. See README.md.",
      );
    }
    await prisma.$connect();
  });

  afterEach(async () => {
    const retentionIds = [...retentionRunIds];
    if (retentionIds.length) {
      await prisma.retentionRun.deleteMany({
        where: { id: { in: retentionIds } },
      });
      retentionRunIds.clear();
    }
    const ids = [...tenantIds];
    if (ids.length === 0) return;
    await prisma.operationalOrderEvent.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.order.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.onlineOrder.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.businessProvision.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
    tenantIds.clear();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("opens a private QR session and persists an idempotent localized table order", async () => {
    const fixture = await createGuestFixture();
    const session = await guestServiceRepository.openSession(fixture.qrToken);

    expect(session).toMatchObject({
      tableLabel: "T-07",
      serviceMode: "ORDER_AND_CONFIRM",
      capabilities: {
        canOrder: true,
        canRequestService: true,
        requiresConfirmation: true,
      },
    });
    const storedGuest = await prisma.tableGuest.findFirstOrThrow({
      where: { tableSessionId: session.sessionId },
    });
    expect(storedGuest.tokenHash).toBe(hashQrToken(session.guestToken));
    expect(storedGuest.tokenHash).not.toBe(session.guestToken);
    expect(fixture.table.qrTokenHash).not.toBe(fixture.qrToken);

    const input = {
      sessionId: session.sessionId,
      guestToken: session.guestToken,
      idempotencyKey: `order-${randomUUID()}`,
      locale: "de" as const,
      items: [{ productId: fixture.product.id, quantity: 2 }],
    };
    const first = await guestServiceRepository.submitOrder(input);
    const repeated = await guestServiceRepository.submitOrder(input);

    expect(repeated.id).toBe(first.id);
    expect(first).toMatchObject({
      status: "NEW",
      totalMinor: 2_900,
      currency: "EUR",
      items: [
        {
          productName: "Gast Integration Gericht",
          quantity: 2,
          unitPriceMinor: 1_450,
        },
      ],
    });
    const persisted = await prisma.order.findUniqueOrThrow({
      where: { id: first.id },
      include: { productionTickets: true, signals: true, statusEvents: true },
    });
    expect(persisted).toMatchObject({
      tenantId: fixture.tenant.id,
      venueId: fixture.venue.id,
      productionTickets: [{ station: "KITCHEN", status: "NEW" }],
      signals: [{ type: "NEW_ORDER" }],
      statusEvents: [{ status: "NEW", kind: "INITIAL" }],
    });
    expect(
      await prisma.order.count({
        where: {
          tenantId: fixture.tenant.id,
          idempotencyKey: input.idempotencyKey,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.operationalOrderEvent.findMany({
        where: { tenantId: fixture.tenant.id, orderId: first.id },
        select: { type: true, source: true, fulfillment: true, status: true },
      }),
    ).toEqual([
      {
        type: "ORDER_CREATED",
        source: "TABLE_GUEST_QR",
        fulfillment: "DINE_IN",
        status: "PENDING_CONFIRMATION",
      },
    ]);

    const requestInput = {
      sessionId: session.sessionId,
      guestToken: session.guestToken,
      idempotencyKey: `request-${randomUUID()}`,
      type: "WAITER_CALL" as const,
    };
    const request = await guestServiceRepository.createRequest(requestInput);
    expect(await guestServiceRepository.createRequest(requestInput)).toEqual(
      request,
    );
  });

  it("rejects a foreign product and a guest token from another table session", async () => {
    const requested = await createGuestFixture();
    const foreign = await createGuestFixture();
    const requestedSession = await guestServiceRepository.openSession(
      requested.qrToken,
    );
    const foreignSession = await guestServiceRepository.openSession(
      foreign.qrToken,
    );

    await expect(
      guestServiceRepository.submitOrder({
        sessionId: requestedSession.sessionId,
        guestToken: requestedSession.guestToken,
        idempotencyKey: randomUUID(),
        locale: "en",
        items: [{ productId: foreign.product.id, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ProductUnavailableError);
    await expect(
      guestServiceRepository.createRequest({
        sessionId: requestedSession.sessionId,
        guestToken: foreignSession.guestToken,
        idempotencyKey: randomUUID(),
        type: "WAITER_CALL",
      }),
    ).rejects.toBeInstanceOf(GuestSessionNotFoundError);
    expect(
      await prisma.order.count({ where: { tenantId: requested.tenant.id } }),
    ).toBe(0);
  });

  it("registers an owner atomically and launches only after every required check", async () => {
    const unique = randomUUID();
    const registration = await trialRegistrationRepository.register({
      organizationName: `Owner Integration ${unique}`,
      venueName: `Launch Venue ${unique}`,
      ownerDisplayName: "Integration Owner",
      email: `owner-${unique}@integration.test`,
      password: "Integration1234!",
      locale: "it",
      timezone: "Europe/Rome",
      currency: "EUR",
      plan: "RESTAURANT_PRO",
    });
    tenantIds.add(registration.staff.tenantId);

    expect(registration).toMatchObject({
      staff: { role: "OWNER", email: `owner-${unique}@integration.test` },
      subscription: { plan: "RESTAURANT_PRO", status: "TRIALING" },
    });
    const storedSession = await prisma.staffSession.findUniqueOrThrow({
      where: { id: registration.staff.sessionId },
    });
    expect(storedSession.tokenHash).toBe(
      hashOpaqueToken(registration.sessionToken),
    );
    expect(storedSession.tokenHash).not.toBe(registration.sessionToken);
    expect(
      await prisma.auditEvent.findFirst({
        where: {
          tenantId: registration.staff.tenantId,
          action: "TRIAL_STARTED",
        },
      }),
    ).not.toBeNull();

    await expect(
      venueLaunchRepository.launch(registration.staff),
    ).rejects.toBeInstanceOf(VenueLaunchBlockedError);
    await completeLaunchPrerequisites({
      tenantId: registration.staff.tenantId,
      venueId: registration.staff.venueId,
    });
    const rehearsed = await venueLaunchRepository.confirmRehearsal(
      registration.staff,
    );
    expect(rehearsed.canLaunch).toBe(true);
    expect(rehearsed.progress.completed).toBe(rehearsed.progress.total);

    const launched = await venueLaunchRepository.launch(registration.staff);
    expect(launched.launchedAt).toBeInstanceOf(Date);
    expect(launched.canLaunch).toBe(true);
    expect(
      await prisma.auditEvent.findMany({
        where: {
          tenantId: registration.staff.tenantId,
          venueId: registration.staff.venueId,
          action: {
            in: ["SERVICE_REHEARSAL_CONFIRMED", "VENUE_LAUNCHED"],
          },
        },
      }),
    ).toHaveLength(2);
  });
});
