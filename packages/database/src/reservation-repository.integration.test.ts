import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "./client.js";
import {
  ReservationNotFoundError,
  reservationRepository,
  ReservationUnavailableError,
} from "./reservation-repository.js";
import {
  customerProfileRepository,
  CustomerProfileNotFoundError,
} from "./customer-profile.js";
import type { StaffIdentity } from "./staff-auth-repository.js";

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

async function createReservationFixture(input: { capacity?: number } = {}) {
  const unique = randomUUID();
  const tenant = await prisma.tenant.create({
    data: { name: `Reservation ${unique}`, slug: `reservation-${unique}` },
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
    data: ["PUBLIC_WEBSITE", "RESERVATIONS", "CUSTOMER_TIMELINE"].map(
      (featureKey) => ({
        tenantId: tenant.id,
        subscriptionId: subscription.id,
        featureKey,
        enabled: true,
      }),
    ),
  });
  const venue = await prisma.venue.create({
    data: {
      tenantId: tenant.id,
      name: "Reservation venue",
      slug: `reservation-venue-${unique}`,
      defaultLocale: "EN",
      timezone: "Europe/Berlin",
      reservationCapacity: input.capacity ?? 40,
    },
  });
  const publicSlug = `reservation-public-${unique}`;
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
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `${unique}@reservation.integration.test`,
      displayName: "Reservation manager",
      passwordHash: "not-used-by-repository-tests",
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
    sessionId: `reservation-${unique}`,
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
  const table = await prisma.diningTable.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      label: "01",
      qrTokenHash: randomUUID(),
    },
  });
  return { tenant, venue, subscription, publicSlug, staff, table };
}

function requestInput(
  fixture: Awaited<ReturnType<typeof createReservationFixture>>,
  overrides: {
    idempotencyKey?: string;
    partySize?: number;
    email?: string | null;
    phone?: string;
  } = {},
) {
  return {
    publicSlug: fixture.publicSlug,
    idempotencyKey: overrides.idempotencyKey ?? randomUUID(),
    guestName: "Ada Lovelace",
    phone: overrides.phone ?? "+4912345678",
    email: overrides.email ?? "ada@example.com",
    locale: "en" as const,
    requestedFor: new Date(Date.now() + 7_200_000),
    partySize: overrides.partySize ?? 2,
    guestNotes: null,
  };
}

function reservationId(result: { reservation: unknown }) {
  return (result.reservation as { id: string }).id;
}

describe.sequential("reservation repository with PostgreSQL", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    await prisma.$connect();
  });

  afterEach(async () => {
    if (tenantIds.size) {
      await prisma.tenant.deleteMany({ where: { id: { in: [...tenantIds] } } });
      tenantIds.clear();
    }
  });
  afterAll(async () => prisma.$disconnect());

  it("rejects public reservations when the module is disabled", async () => {
    const fixture = await createReservationFixture();
    await prisma.entitlement.updateMany({
      where: {
        subscriptionId: fixture.subscription.id,
        featureKey: "RESERVATIONS",
      },
      data: { enabled: false },
    });
    await expect(
      reservationRepository.create(requestInput(fixture)),
    ).rejects.toBeInstanceOf(ReservationUnavailableError);
  });

  it("keeps a public request idempotent and sends confirmation metadata once", async () => {
    const fixture = await createReservationFixture();
    await prisma.venue.update({
      where: { id: fixture.venue.id },
      data: { reservationAutoConfirm: true },
    });
    const idempotencyKey = randomUUID();

    const first = await reservationRepository.create(
      requestInput(fixture, { idempotencyKey }),
    );
    const repeated = await reservationRepository.create(
      requestInput(fixture, { idempotencyKey }),
    );

    expect(first.confirmation).toMatchObject({
      recipient: "ada@example.com",
      locale: "en",
      venueName: fixture.venue.name,
    });
    expect(repeated.confirmation).toBeNull();
    expect(reservationId(repeated)).toBe(reservationId(first));
    expect(
      await prisma.reservation.count({
        where: { tenantId: fixture.tenant.id },
      }),
    ).toBe(1);
    const persisted = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservationId(first) },
      include: { customerProfile: true },
    });
    expect(persisted.customerProfile).toMatchObject({
      tenantId: fixture.tenant.id,
      venueId: fixture.venue.id,
      displayName: "Ada Lovelace",
      emailNormalized: "ada@example.com",
      phoneNormalized: "+4912345678",
      preferredLocale: "EN",
    });
  });

  it("detaches a deleted profile without changing the reservation snapshot", async () => {
    const fixture = await createReservationFixture();
    const created = await reservationRepository.create(requestInput(fixture));
    const reservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservationId(created) },
    });
    expect(reservation.customerProfileId).not.toBeNull();

    await prisma.customerProfile.delete({
      where: { id: reservation.customerProfileId! },
    });

    await expect(
      prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } }),
    ).resolves.toMatchObject({
      customerProfileId: null,
      guestName: "Ada Lovelace",
      phone: "+4912345678",
      email: "ada@example.com",
    });
  });

  it("scopes customer correction and timeline to the staff venue", async () => {
    const fixture = await createReservationFixture();
    const other = await createReservationFixture();
    const created = await reservationRepository.create(requestInput(fixture));
    const reservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservationId(created) },
    });
    const profileId = reservation.customerProfileId!;

    await expect(
      customerProfileRepository.get({
        staff: other.staff,
        customerProfileId: profileId,
      }),
    ).rejects.toBeInstanceOf(CustomerProfileNotFoundError);

    const corrected = await customerProfileRepository.update({
      staff: fixture.staff,
      customerProfileId: profileId,
      displayName: "Ada Byron",
      email: "ADA@EXAMPLE.COM ",
      phone: "+49 (123) 45678",
      preferredLocale: "de",
      internalNotes: "Prefers a quiet table",
    });
    expect(corrected).toMatchObject({
      displayName: "Ada Byron",
      emailNormalized: "ada@example.com",
      phoneNormalized: "+4912345678",
      preferredLocale: "DE",
      internalNotes: "Prefers a quiet table",
    });
    await expect(
      customerProfileRepository.get({
        staff: fixture.staff,
        customerProfileId: profileId,
      }),
    ).resolves.toMatchObject({
      id: profileId,
      reservations: [expect.objectContaining({ id: reservation.id })],
    });
    await expect(
      customerProfileRepository.list(fixture.staff),
    ).resolves.toEqual([
      expect.objectContaining({
        id: profileId,
        _count: { reservations: 1, onlineOrders: 0 },
      }),
    ]);
    await expect(
      prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } }),
    ).resolves.toMatchObject({
      guestName: "Ada Lovelace",
      phone: "+4912345678",
      email: "ada@example.com",
    });
  });

  it("finds only same-venue exact contact candidates for staff review", async () => {
    const fixture = await createReservationFixture();
    const other = await createReservationFixture();
    const first = await reservationRepository.create(requestInput(fixture));
    const second = await reservationRepository.create(
      requestInput(fixture, {
        idempotencyKey: randomUUID(),
        phone: "+49 (123) 45678",
      }),
    );
    await reservationRepository.create(requestInput(other));
    const firstReservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservationId(first) },
    });
    const secondReservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservationId(second) },
    });

    await expect(
      customerProfileRepository.findDuplicateCandidates({
        staff: fixture.staff,
        customerProfileId: firstReservation.customerProfileId!,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: secondReservation.customerProfileId,
        matchingFields: ["email", "phone"],
        _count: { reservations: 1, onlineOrders: 0 },
      }),
    ]);
    await expect(
      customerProfileRepository.findDuplicateCandidates({
        staff: other.staff,
        customerProfileId: firstReservation.customerProfileId!,
      }),
    ).rejects.toBeInstanceOf(CustomerProfileNotFoundError);
  });

  it("rejects unpublished or closed venues and capacity beyond the configured limit", async () => {
    const unpublished = await createReservationFixture();
    await prisma.venueWebsite.update({
      where: { venueId: unpublished.venue.id },
      data: { status: "DRAFT" },
    });
    await expect(
      reservationRepository.create(requestInput(unpublished)),
    ).rejects.toBeInstanceOf(ReservationUnavailableError);

    const closed = await createReservationFixture();
    await prisma.venueWebsite.update({
      where: { venueId: closed.venue.id },
      data: {
        openingHours: openingHours.map((entry) => ({ ...entry, closed: true })),
      },
    });
    await expect(
      reservationRepository.create(requestInput(closed)),
    ).rejects.toBeInstanceOf(ReservationUnavailableError);

    const constrained = await createReservationFixture({ capacity: 3 });
    const input = requestInput(constrained, { partySize: 2 });
    await reservationRepository.create(input);
    await expect(
      reservationRepository.create({
        ...input,
        idempotencyKey: randomUUID(),
        partySize: 2,
      }),
    ).rejects.toBeInstanceOf(ReservationUnavailableError);
  });

  it("rejects foreign table assignment and keeps reservations tenant-scoped", async () => {
    const first = await createReservationFixture();
    const second = await createReservationFixture();
    const created = await reservationRepository.create(requestInput(first));
    const id = reservationId(created);

    await expect(
      reservationRepository.transition({
        staff: first.staff,
        reservationId: id,
        status: "CONFIRMED",
        tableId: second.table.id,
      }),
    ).rejects.toBeInstanceOf(ReservationNotFoundError);
    expect(
      await reservationRepository.list({
        staff: second.staff,
        date: new Date(new Date().toISOString().slice(0, 10)),
      }),
    ).toEqual([]);
    expect(
      (await prisma.reservation.findUniqueOrThrow({ where: { id } })).status,
    ).toBe("REQUESTED");
  });

  it("persists valid lifecycle transitions and rejects an invalid terminal transition", async () => {
    const fixture = await createReservationFixture();
    const created = await reservationRepository.create(requestInput(fixture));
    const id = reservationId(created);
    await reservationRepository.transition({
      staff: fixture.staff,
      reservationId: id,
      status: "CONFIRMED",
      tableId: fixture.table.id,
    });
    await reservationRepository.transition({
      staff: fixture.staff,
      reservationId: id,
      status: "SEATED",
      tableId: fixture.table.id,
    });
    await reservationRepository.transition({
      staff: fixture.staff,
      reservationId: id,
      status: "COMPLETED",
      tableId: fixture.table.id,
    });
    await expect(
      reservationRepository.transition({
        staff: fixture.staff,
        reservationId: id,
        status: "CANCELLED",
        tableId: fixture.table.id,
      }),
    ).rejects.toThrow("Cannot transition reservation");
    const audits = await prisma.auditEvent.findMany({
      where: {
        tenantId: fixture.tenant.id,
        entityId: id,
        action: "RESERVATION_STATUS_CHANGED",
      },
    });
    expect(audits).toHaveLength(3);
    expect(JSON.stringify(audits.map((event) => event.metadata))).not.toContain(
      "ada@example.com",
    );
    expect(JSON.stringify(audits.map((event) => event.metadata))).not.toContain(
      "+4912345678",
    );
  });
});
