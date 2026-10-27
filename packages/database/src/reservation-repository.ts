import {
  assertReservationRequest,
  assertStaffPermission,
  isWithinOpeningHours,
  transitionReservation,
  type PlatformLocale,
  type ReservationStatus,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import { subscriptionRepository } from "./subscription-repository.js";
import { createCustomerProfileFromContact } from "./customer-profile-repository.js";
import type { StaffIdentity } from "./staff-auth-repository.js";

export class ReservationUnavailableError extends Error {}
export class ReservationNotFoundError extends Error {}

export type ReservationConfirmedNotification = {
  recipient: string;
  locale: PlatformLocale;
  venueName: string;
  requestedFor: Date;
  timezone: string;
  partySize: number;
};

type ReservationWriteResult = {
  reservation: unknown;
  confirmation: ReservationConfirmedNotification | null;
};

type PublicReservation = {
  publicSlug: string;
  idempotencyKey: string;
  guestName: string;
  phone: string;
  email: string | null;
  locale: PlatformLocale;
  requestedFor: Date;
  partySize: number;
  guestNotes: string | null;
};

function scope(staff: StaffIdentity) {
  return { tenantId: staff.tenantId, venueId: staff.venueId };
}

export type ReservationRepository = {
  getAutoConfirm(staff: StaffIdentity): Promise<{ enabled: boolean }>;
  setAutoConfirm(input: {
    staff: StaffIdentity;
    enabled: boolean;
  }): Promise<{ enabled: boolean }>;
  create(input: PublicReservation): Promise<ReservationWriteResult>;
  list(input: { staff: StaffIdentity; date: Date }): Promise<unknown>;
  transition(input: {
    staff: StaffIdentity;
    reservationId: string;
    status: ReservationStatus;
    tableId: string | null;
  }): Promise<ReservationWriteResult>;
};

export const reservationRepository: ReservationRepository = {
  async getAutoConfirm(staff) {
    assertStaffPermission(staff.role, "RESERVATION_VIEW");
    const venue = await prisma.venue.findFirstOrThrow({
      where: { id: staff.venueId, tenantId: staff.tenantId },
      select: { reservationAutoConfirm: true },
    });
    return { enabled: venue.reservationAutoConfirm };
  },
  async setAutoConfirm({ staff, enabled }) {
    assertStaffPermission(staff.role, "RESERVATION_MANAGE");
    const venue = await prisma.venue.update({
      where: { id: staff.venueId },
      data: { reservationAutoConfirm: enabled },
      select: { reservationAutoConfirm: true },
    });
    return { enabled: venue.reservationAutoConfirm };
  },
  async create(input) {
    assertReservationRequest({
      requestedFor: input.requestedFor,
      now: new Date(),
      partySize: input.partySize,
    });
    const website = await prisma.venueWebsite.findUnique({
      where: { publicSlug: input.publicSlug },
      include: {
        venue: true,
        tenant: {
          include: { subscription: { include: { entitlements: true } } },
        },
      },
    });
    const enabled = ["PUBLIC_WEBSITE", "RESERVATIONS"].every((featureKey) =>
      website?.tenant.subscription?.entitlements.some(
        (item) => item.featureKey === featureKey && item.enabled,
      ),
    );
    if (
      !website ||
      website.status !== "PUBLISHED" ||
      !enabled ||
      !isWithinOpeningHours({
        at: input.requestedFor,
        timezone: website.venue.timezone,
        openingHours:
          website.openingHours as unknown as import("@flowgastronomie/domain").OpeningHoursEntry[],
      })
    )
      throw new ReservationUnavailableError();
    const existing = await prisma.reservation.findUnique({
      where: {
        tenantId_venueId_idempotencyKey: {
          tenantId: website.tenantId,
          venueId: website.venueId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) return { reservation: existing, confirmation: null };
    const duration = website.venue.reservationDurationMinutes;
    const startsAt = new Date(input.requestedFor.getTime() - duration * 60_000);
    const endsAt = new Date(input.requestedFor.getTime() + duration * 60_000);
    const booked = await prisma.reservation.aggregate({
      where: {
        tenantId: website.tenantId,
        venueId: website.venueId,
        status: { in: ["REQUESTED", "CONFIRMED", "SEATED"] },
        requestedFor: { gt: startsAt, lt: endsAt },
      },
      _sum: { partySize: true },
    });
    if (
      (booked._sum.partySize ?? 0) + input.partySize >
      website.venue.reservationCapacity
    )
      throw new ReservationUnavailableError();
    const reservation = await prisma.$transaction(async (transaction) => {
      const customerProfile = await createCustomerProfileFromContact(
        transaction,
        {
          tenantId: website.tenantId,
          venueId: website.venueId,
          displayName: input.guestName,
          email: input.email,
          phone: input.phone,
          preferredLocale: input.locale,
        },
      );
      return transaction.reservation.create({
        data: {
          tenantId: website.tenantId,
          venueId: website.venueId,
          idempotencyKey: input.idempotencyKey,
          guestName: input.guestName,
          phone: input.phone,
          email: input.email,
          customerProfileId: customerProfile.id,
          locale: input.locale.toUpperCase() as "EN" | "DE" | "IT" | "SQ",
          requestedFor: input.requestedFor,
          partySize: input.partySize,
          guestNotes: input.guestNotes,
          bookingDurationMinutes: duration,
          status: website.venue.reservationAutoConfirm
            ? "CONFIRMED"
            : "REQUESTED",
        },
      });
    });
    return {
      reservation,
      confirmation:
        reservation.status === "CONFIRMED" && reservation.email
          ? {
              recipient: reservation.email,
              locale: input.locale,
              venueName: website.venue.name,
              requestedFor: reservation.requestedFor,
              timezone: website.venue.timezone,
              partySize: reservation.partySize,
            }
          : null,
    };
  },

  async list({ staff, date }) {
    await subscriptionRepository.assertFeature(staff.tenantId, "RESERVATIONS");
    assertStaffPermission(staff.role, "RESERVATION_VIEW");
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 1);
    return prisma.reservation.findMany({
      where: { ...scope(staff), requestedFor: { gte: date, lt: next } },
      include: { table: { select: { id: true, label: true } } },
      orderBy: { requestedFor: "asc" },
    });
  },

  async transition({ staff, reservationId, status, tableId }) {
    await subscriptionRepository.assertFeature(staff.tenantId, "RESERVATIONS");
    assertStaffPermission(staff.role, "RESERVATION_MANAGE");
    const current = await prisma.reservation.findFirst({
      where: { id: reservationId, ...scope(staff) },
      include: { venue: { select: { name: true, timezone: true } } },
    });
    if (!current) throw new ReservationNotFoundError();
    transitionReservation(current.status as ReservationStatus, status);
    if (tableId) {
      const table = await prisma.diningTable.findFirst({
        where: { id: tableId, ...scope(staff) },
        select: { id: true },
      });
      if (!table) throw new ReservationNotFoundError();
    }
    return prisma.$transaction(async (tx) => {
      const updated = await tx.reservation.update({
        where: { id: current.id },
        data: {
          status,
          tableId,
          statusChangedAt: new Date(),
          statusChangedByUserId: staff.userId,
        },
      });
      await tx.auditEvent.create({
        data: {
          ...scope(staff),
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
          action: "RESERVATION_STATUS_CHANGED",
          entityType: "Reservation",
          entityId: current.id,
          metadata: { from: current.status, to: status, tableId },
        },
      });
      return {
        reservation: updated,
        confirmation:
          status === "CONFIRMED" && current.email
            ? {
                recipient: current.email,
                locale: current.locale.toLowerCase() as PlatformLocale,
                venueName: current.venue.name,
                requestedFor: current.requestedFor,
                timezone: current.venue.timezone,
                partySize: current.partySize,
              }
            : null,
      };
    });
  },
};
