import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "./client.js";
import {
  ScheduleResourceNotFoundError,
  staffScheduleRepository,
} from "./staff-schedule-repository.js";
import type { StaffIdentity } from "./staff-auth-repository.js";

const tenantIds = new Set<string>();

async function fixture(role: "MANAGER" | "WAITER" = "MANAGER") {
  const unique = randomUUID();
  const tenant = await prisma.tenant.create({
    data: { name: `Schedule ${unique}`, slug: `schedule-${unique}` },
  });
  tenantIds.add(tenant.id);
  const venue = await prisma.venue.create({
    data: {
      tenantId: tenant.id,
      name: "Schedule venue",
      slug: `schedule-venue-${unique}`,
      defaultLocale: "EN",
      timezone: "Europe/Berlin",
    },
  });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `${unique}@schedule.integration.test`,
      displayName: "Schedule worker",
      passwordHash: "not-used",
    },
  });
  const membership = await prisma.membership.create({
    data: { tenantId: tenant.id, venueId: venue.id, userId: user.id, role },
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
  return { tenant, venue, membership, staff };
}

describe.sequential("staff schedule repository with PostgreSQL", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    await prisma.$connect();
  });

  afterEach(async () => {
    if (tenantIds.size) {
      await prisma.$transaction(async (tx) => {
        const url = new URL(process.env.DATABASE_URL!);
        if (!["localhost", "127.0.0.1"].includes(url.hostname))
          throw new Error("Schedule fixture cleanup is local only");
        const ids = [...tenantIds],
          fixtures = await tx.tenant.findMany({
            where: { id: { in: ids } },
            select: {
              id: true,
              slug: true,
              users: { select: { email: true } },
            },
          });
        if (
          fixtures.length !== ids.length ||
          fixtures.some(
            (t) =>
              !/^schedule-[0-9a-f-]{36}$/.test(t.slug) ||
              t.users.some(
                (u) => !u.email.endsWith("@schedule.integration.test"),
              ),
          )
        )
          throw new Error("Refusing unidentified schedule fixture cleanup");
        if (
          await tx.workforceMonthlyClose.count({
            where: { tenantId: { in: ids } },
          })
        )
          throw new Error("Unexpected closed account in schedule fixture");
        await tx.$executeRaw`SET LOCAL flowgastronomie.test_cleanup = 'on'`;
        // New publication outbox rows deliberately use RESTRICT in runtime.
        // Only these validated synthetic fixture tenants may be cleared here.
        const where = { tenantId: { in: ids } };
        await tx.workforceNotificationDeliveryAttempt.deleteMany({ where });
        await tx.workforceNotificationDelivery.deleteMany({ where });
        await tx.workforceNotificationReceipt.deleteMany({ where });
        await tx.workforceNotification.deleteMany({ where });
        await tx.workforceNotificationPreferenceRevision.deleteMany({ where });
        await tx.workforceNotificationPreference.deleteMany({ where });
        await tx.workforcePushSubscription.deleteMany({ where });
        await tx.tenant.deleteMany({ where: { id: { in: [...tenantIds] } } });
      });
      tenantIds.clear();
    }
  });
  afterAll(async () => prisma.$disconnect());

  it("publishes a scoped weekly schedule and gives a worker only their assignments", async () => {
    const manager = await fixture();
    const waiter = await prisma.user.create({
      data: {
        tenantId: manager.tenant.id,
        email: `${randomUUID()}@schedule.integration.test`,
        displayName: "Waiter",
        passwordHash: "not-used",
      },
    });
    const waiterMembership = await prisma.membership.create({
      data: {
        tenantId: manager.tenant.id,
        venueId: manager.venue.id,
        userId: waiter.id,
        role: "WAITER",
      },
    });
    const waiterStaff: StaffIdentity = {
      ...manager.staff,
      userId: waiter.id,
      membershipId: waiterMembership.id,
      displayName: waiter.displayName,
      email: waiter.email,
      role: "WAITER",
    };
    const weekStartsOn = new Date("2030-08-12T00:00:00.000Z");
    await staffScheduleRepository.save({
      staff: manager.staff,
      weekStartsOn,
      status: "PUBLISHED",
      assignments: [
        {
          membershipId: manager.membership.id,
          role: "MANAGER",
          startsAt: new Date("2030-08-12T08:00:00Z"),
          endsAt: new Date("2030-08-12T16:00:00Z"),
        },
        {
          membershipId: waiterMembership.id,
          role: "WAITER",
          startsAt: new Date("2030-08-12T10:00:00Z"),
          endsAt: new Date("2030-08-12T18:00:00Z"),
        },
      ],
    });
    const schedule = await prisma.venueSchedule.findFirstOrThrow({
      where: { venueId: manager.venue.id, weekStartsOn },
      include: { assignments: true },
    });
    expect(schedule.status).toBe("PUBLISHED");
    expect(schedule.assignments).toHaveLength(2);
    expect(
      await prisma.auditEvent.count({
        where: { entityId: schedule.id, action: "SCHEDULE_PUBLISHED" },
      }),
    ).toBe(1);
    await staffScheduleRepository.createTask({
      staff: manager.staff,
      scope: "VENUE",
      scopeId: null,
      title: "Check opening station",
      dueAt: null,
      priority: "NORMAL",
      assigneeMembershipId: waiterMembership.id,
    });
    const waiterView = (await staffScheduleRepository.list({
      staff: waiterStaff,
      weekStartsOn,
    })) as {
      schedule: { assignments: Array<{ membershipId: string }> };
      tasks: unknown[];
    };
    expect(waiterView.schedule.assignments).toEqual([
      expect.objectContaining({ membershipId: waiterMembership.id }),
    ]);
    expect(waiterView.tasks).toHaveLength(1);
  });

  it("rejects overlapping assignments and foreign table task scopes", async () => {
    const first = await fixture();
    const second = await fixture();
    const startsAt = new Date("2030-08-12T08:00:00Z");
    await expect(
      staffScheduleRepository.save({
        staff: first.staff,
        weekStartsOn: new Date("2030-08-12T00:00:00Z"),
        status: "DRAFT",
        assignments: [
          {
            membershipId: first.membership.id,
            role: "MANAGER",
            startsAt,
            endsAt: new Date("2030-08-12T16:00:00Z"),
          },
          {
            membershipId: first.membership.id,
            role: "MANAGER",
            startsAt: new Date("2030-08-12T15:00:00Z"),
            endsAt: new Date("2030-08-12T19:00:00Z"),
          },
        ],
      }),
    ).rejects.toThrow("overlapping");
    const foreignTable = await prisma.diningTable.create({
      data: {
        tenantId: second.tenant.id,
        venueId: second.venue.id,
        label: "01",
        qrTokenHash: randomUUID(),
      },
    });
    await expect(
      staffScheduleRepository.createTask({
        staff: first.staff,
        scope: "TABLE",
        scopeId: foreignTable.id,
        title: "Reset table",
        dueAt: null,
        priority: "NORMAL",
        assigneeMembershipId: null,
      }),
    ).rejects.toBeInstanceOf(ScheduleResourceNotFoundError);
  });
});
