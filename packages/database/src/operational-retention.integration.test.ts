import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "./client.js";
import { legalHoldRepository } from "./legal-hold-repository.js";
import {
  checkOperationalRetention,
  runOperationalRetention,
} from "./operational-retention.js";
import { SubscriptionAccessDeniedError } from "./subscription-repository.js";

const tenantIds = new Set<string>();
const retentionRunIds = new Set<string>();

async function createFixture() {
  const unique = randomUUID();
  const old = new Date("2026-04-01T12:00:00.000Z");
  const guestTokenHash = `guest-token-${unique}`;
  const tenant = await prisma.tenant.create({
    data: { name: `Retention ${unique}`, slug: `retention-${unique}` },
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
      featureKey: "OPERATIONAL_RETENTION",
      enabled: true,
    },
  });
  const venue = await prisma.venue.create({
    data: {
      tenantId: tenant.id,
      name: "Retention venue",
      slug: `retention-venue-${unique}`,
      defaultLocale: "EN",
      timezone: "Europe/Berlin",
      currency: "EUR",
    },
  });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `${unique}@retention.integration.test`,
      displayName: "Retention owner",
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
  const profile = await prisma.customerProfile.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      displayName: "Guest name",
      phoneNormalized: "+4930123456",
      preferredLocale: "EN",
      createdAt: old,
    },
  });
  const order = await prisma.onlineOrder.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      idempotencyKey: `retention-${unique}`,
      referenceCode: `RF-${unique.slice(0, 8)}`,
      trackingTokenHash: `token-${unique}`,
      fulfillmentType: "DELIVERY",
      status: "COMPLETED",
      totalMinor: 1_200,
      currency: "EUR",
      contactName: "Guest name",
      contactPhone: "+49 30 123456",
      contactEmail: "guest@example.test",
      customerProfileId: profile.id,
      requestedFor: old,
      deliveryAddressLine: "Teststraße 1",
      deliveryPostalCode: "10115",
      deliveryCity: "Berlin",
      guestNotes: "Door code 1234",
      createdAt: old,
      updatedAt: old,
      messages: {
        create: {
          author: "GUEST",
          body: "Call me at the door",
          createdAt: old,
        },
      },
    },
  });
  const reservation = await prisma.reservation.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      idempotencyKey: `reservation-${unique}`,
      guestName: "Guest name",
      phone: "+49 30 123456",
      email: "guest@example.test",
      requestedFor: old,
      partySize: 2,
      guestNotes: "Allergy note",
      customerProfileId: profile.id,
      createdAt: old,
      updatedAt: old,
    },
  });
  const table = await prisma.diningTable.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      label: "1",
      qrTokenHash: `qr-${unique}`,
    },
  });
  const session = await prisma.tableSession.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      tableId: table.id,
      status: "CLOSED",
      openedAt: old,
      closedAt: old,
    },
  });
  const guest = await prisma.tableGuest.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      tableSessionId: session.id,
      tokenHash: guestTokenHash,
      createdAt: old,
      lastSeenAt: old,
    },
  });
  await prisma.staffSession.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      userId: user.id,
      membershipId: membership.id,
      tokenHash: `staff-token-${unique}`,
      createdAt: old,
      expiresAt: old,
    },
  });
  return {
    guest,
    guestTokenHash,
    order,
    profile,
    reservation,
    tenant,
    venue,
    staff: {
      sessionId: `retention-${unique}`,
      userId: user.id,
      membershipId: membership.id,
      displayName: user.displayName,
      email: user.email,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      venueId: venue.id,
      venueName: venue.name,
      venueSlug: venue.slug,
      role: "OWNER" as const,
    },
  };
}

describe.sequential("operational retention with PostgreSQL", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    await prisma.$connect();
  });

  afterEach(async () => {
    const ids = [...tenantIds];
    if (ids.length) {
      await prisma.onlineOrder.deleteMany({ where: { tenantId: { in: ids } } });
      await prisma.reservation.deleteMany({ where: { tenantId: { in: ids } } });
      // Holds have no tenant relation, so tenant deletion does not cascade;
      // a leaked active hold would silently change later redaction runs.
      await prisma.retentionLegalHold.deleteMany({
        where: { tenantId: { in: ids } },
      });
      await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
      tenantIds.clear();
    }
    if (retentionRunIds.size) {
      await prisma.retentionRun.deleteMany({
        where: { id: { in: [...retentionRunIds] } },
      });
      retentionRunIds.clear();
    }
  });

  afterAll(async () => prisma.$disconnect());

  it("redacts expired guest data while preserving operational source totals", async () => {
    const fixture = await createFixture();
    const now = new Date("2026-08-11T12:00:00.000Z");
    await prisma.onlineOrderRecoverySession.create({
      data: {
        tenantId: fixture.tenant.id,
        venueId: fixture.venue.id,
        onlineOrderId: fixture.order.id,
        tokenHash: `expired-recovery-${fixture.order.id}`,
        expiresAt: new Date(now.getTime() - 1000),
      },
    });
    const first = await runOperationalRetention({ now });
    const runs = await prisma.retentionRun.findMany({
      where: { startedAt: now },
      orderBy: { startedAt: "asc" },
    });
    runs.forEach((run) => retentionRunIds.add(run.id));

    expect(first).toEqual({
      onlineOrdersRedacted: 1,
      reservationsRedacted: 1,
      customerProfilesDeleted: 1,
      messagesDeleted: 1,
      guestTokensRedacted: 1,
      staffSessionsDeleted: 1,
      orderRecoverySessionsDeleted: 1,
    });
    const [order, reservation, guest] = await Promise.all([
      prisma.onlineOrder.findUniqueOrThrow({ where: { id: fixture.order.id } }),
      prisma.reservation.findUniqueOrThrow({
        where: { id: fixture.reservation.id },
      }),
      prisma.tableGuest.findUniqueOrThrow({ where: { id: fixture.guest.id } }),
    ]);
    expect(order).toMatchObject({
      totalMinor: 1_200,
      contactName: "Deleted guest",
      contactPhone: "[deleted]",
      contactEmail: null,
      deliveryAddressLine: null,
      guestNotes: null,
      customerProfileId: null,
      personalDataRedactedAt: now,
    });
    expect(reservation).toMatchObject({
      guestName: "Deleted guest",
      phone: "[deleted]",
      email: null,
      guestNotes: null,
      customerProfileId: null,
      personalDataRedactedAt: now,
    });
    expect(guest).toMatchObject({ tokenRedactedAt: now });
    expect(guest.tokenHash).not.toBe(fixture.guestTokenHash);
    await expect(
      prisma.customerProfile.findUniqueOrThrow({
        where: { id: fixture.profile.id },
      }),
    ).rejects.toMatchObject({ code: "P2025" });
    expect(await prisma.onlineOrderMessage.count()).toBe(0);
    expect(
      await prisma.staffSession.count({
        where: { tenantId: fixture.tenant.id },
      }),
    ).toBe(0);
    expect(runs.at(-1)).toMatchObject({ status: "COMPLETED", summary: first });
    await expect(checkOperationalRetention({ now })).resolves.toMatchObject({
      healthy: true,
      lastCompletedAt: expect.any(Date),
    });
    await expect(
      checkOperationalRetention({
        now: new Date("2099-01-01T00:00:00.000Z"),
      }),
    ).resolves.toEqual({ healthy: false, lastCompletedAt: null });

    expect(await runOperationalRetention({ now })).toEqual({
      onlineOrdersRedacted: 0,
      reservationsRedacted: 0,
      customerProfilesDeleted: 0,
      messagesDeleted: 0,
      guestTokensRedacted: 0,
      staffSessionsDeleted: 0,
      orderRecoverySessionsDeleted: 0,
    });
    (await prisma.retentionRun.findMany({ where: { startedAt: now } })).forEach(
      (run) => retentionRunIds.add(run.id),
    );
  });

  it("keeps an active targeted hold out of retention and permits attributed release", async () => {
    const fixture = await createFixture();
    const now = new Date("2026-08-11T12:00:00.000Z");
    const hold = await legalHoldRepository.create({
      staff: fixture.staff,
      target: "ONLINE_ORDER",
      targetId: fixture.order.id,
      reason: "Open service dispute",
      // The domain rejects hold dates that are not in the future relative to
      // the real clock, so fixed calendar dates would expire as time passes.
      reviewAt: new Date(Date.now() + 7 * 86_400_000),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    });
    expect(await runOperationalRetention({ now })).toMatchObject({
      onlineOrdersRedacted: 0,
      reservationsRedacted: 1,
    });
    // This run shares test 1's fixed startedAt, so it must be registered for
    // cleanup; otherwise it survives and collides with that test's run lookup.
    (await prisma.retentionRun.findMany({ where: { startedAt: now } })).forEach(
      (run) => retentionRunIds.add(run.id),
    );
    expect(
      await prisma.onlineOrder.findUniqueOrThrow({
        where: { id: fixture.order.id },
      }),
    ).toMatchObject({
      contactName: "Guest name",
      personalDataRedactedAt: null,
    });
    const released = await legalHoldRepository.release({
      staff: fixture.staff,
      holdId: hold.id,
    });
    expect(released.releasedAt).toBeInstanceOf(Date);
  });

  it("denies legal hold administration after its entitlement is disabled", async () => {
    const fixture = await createFixture();
    await prisma.entitlement.updateMany({
      where: {
        tenantId: fixture.tenant.id,
        featureKey: "OPERATIONAL_RETENTION",
      },
      data: { enabled: false },
    });

    await expect(
      legalHoldRepository.list(fixture.staff),
    ).rejects.toBeInstanceOf(SubscriptionAccessDeniedError);
  });
});
