import { createHash } from "node:crypto";

import { operationalRetentionCutoffs } from "@flowgastronomie/domain";

import { prisma } from "./client.js";

const REDACTED_GUEST_NAME = "Deleted guest";
const REDACTED_GUEST_PHONE = "[deleted]";

export type OperationalRetentionSummary = {
  onlineOrdersRedacted: number;
  reservationsRedacted: number;
  customerProfilesDeleted: number;
  messagesDeleted: number;
  guestTokensRedacted: number;
  staffSessionsDeleted: number;
  orderRecoverySessionsDeleted: number;
};

export async function checkOperationalRetention(input: { now?: Date } = {}) {
  const now = input.now ?? new Date();
  const deadline = new Date(now.getTime() - 48 * 60 * 60 * 1_000);
  const latest = await prisma.retentionRun.findFirst({
    where: { status: "COMPLETED", completedAt: { gte: deadline } },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true },
  });
  return {
    healthy: Boolean(latest),
    lastCompletedAt: latest?.completedAt ?? null,
  };
}

function revokedTokenHash(guestId: string) {
  return createHash("sha256")
    .update(`retention-revoked-table-guest:${guestId}`)
    .digest("hex");
}

export async function runOperationalRetention(input: { now?: Date } = {}) {
  const now = input.now ?? new Date();
  const cutoffs = operationalRetentionCutoffs(now);
  const run = await prisma.retentionRun.create({ data: { startedAt: now } });

  try {
    const summary = await prisma.$transaction(async (transaction) => {
      const recoverySessions =
        await transaction.onlineOrderRecoverySession.deleteMany({
          where: { expiresAt: { lte: now } },
        });
      const holds = await transaction.retentionLegalHold.findMany({
        where: { releasedAt: null, expiresAt: { gt: now } },
        select: { target: true, targetId: true },
      });
      const held = (
        target: "ONLINE_ORDER" | "RESERVATION" | "CUSTOMER_PROFILE",
      ) =>
        holds
          .filter((hold) => hold.target === target)
          .map((hold) => hold.targetId);
      const heldProfiles = held("CUSTOMER_PROFILE");
      const heldSources = heldProfiles.length
        ? await transaction.customerProfile.findMany({
            where: { id: { in: heldProfiles } },
            select: {
              onlineOrders: { select: { id: true } },
              reservations: { select: { id: true } },
            },
          })
        : [];
      const heldOnlineOrders = [
        ...held("ONLINE_ORDER"),
        ...heldSources.flatMap((profile) =>
          profile.onlineOrders.map((order) => order.id),
        ),
      ];
      const heldReservations = [
        ...held("RESERVATION"),
        ...heldSources.flatMap((profile) =>
          profile.reservations.map((reservation) => reservation.id),
        ),
      ];
      const [onlineOrders, reservations, messages, staffSessions, tableGuests] =
        await Promise.all([
          transaction.onlineOrder.updateMany({
            where: {
              requestedFor: { lt: cutoffs.guestContact },
              personalDataRedactedAt: null,
              ...(heldOnlineOrders.length
                ? { id: { notIn: heldOnlineOrders } }
                : {}),
            },
            data: {
              contactName: REDACTED_GUEST_NAME,
              contactPhone: REDACTED_GUEST_PHONE,
              contactEmail: null,
              deliveryAddressLine: null,
              deliveryPostalCode: null,
              deliveryCity: null,
              guestNotes: null,
              personalDataRedactedAt: now,
            },
          }),
          transaction.reservation.updateMany({
            where: {
              requestedFor: { lt: cutoffs.guestContact },
              personalDataRedactedAt: null,
              ...(heldReservations.length
                ? { id: { notIn: heldReservations } }
                : {}),
            },
            data: {
              guestName: REDACTED_GUEST_NAME,
              phone: REDACTED_GUEST_PHONE,
              email: null,
              guestNotes: null,
              personalDataRedactedAt: now,
            },
          }),
          transaction.onlineOrderMessage.deleteMany({
            where: { createdAt: { lt: cutoffs.guestMessage } },
          }),
          transaction.staffSession.deleteMany({
            where: { expiresAt: { lt: cutoffs.staffSession } },
          }),
          transaction.tableGuest.findMany({
            where: {
              tokenRedactedAt: null,
              tableSession: {
                status: "CLOSED",
                closedAt: { lt: cutoffs.guestToken },
              },
            },
            select: { id: true },
          }),
        ]);
      await Promise.all(
        tableGuests.map((guest) =>
          transaction.tableGuest.update({
            where: { id: guest.id },
            data: {
              tokenHash: revokedTokenHash(guest.id),
              tokenRedactedAt: now,
            },
          }),
        ),
      );

      const profiles = await transaction.customerProfile.findMany({
        select: {
          id: true,
          createdAt: true,
          reservations: { select: { requestedFor: true } },
          onlineOrders: { select: { requestedFor: true } },
        },
      });
      const expiredProfileIds = profiles
        .filter((profile) => {
          const sourceTimes = [
            ...profile.reservations.map(
              (reservation) => reservation.requestedFor,
            ),
            ...profile.onlineOrders.map((order) => order.requestedFor),
          ];
          const latestSource = sourceTimes.reduce<Date | null>(
            (latest, sourceTime) =>
              !latest || sourceTime > latest ? sourceTime : latest,
            null,
          );
          return (
            !heldProfiles.includes(profile.id) &&
            (latestSource ?? profile.createdAt) < cutoffs.guestContact
          );
        })
        .map((profile) => profile.id);
      const customerProfiles = expiredProfileIds.length
        ? await transaction.customerProfile.deleteMany({
            where: { id: { in: expiredProfileIds } },
          })
        : { count: 0 };

      return {
        onlineOrdersRedacted: onlineOrders.count,
        reservationsRedacted: reservations.count,
        customerProfilesDeleted: customerProfiles.count,
        messagesDeleted: messages.count,
        guestTokensRedacted: tableGuests.length,
        staffSessionsDeleted: staffSessions.count,
        orderRecoverySessionsDeleted: recoverySessions.count,
      } satisfies OperationalRetentionSummary;
    });
    await prisma.retentionRun.update({
      where: { id: run.id },
      data: { status: "COMPLETED", completedAt: new Date(), summary },
    });
    return summary;
  } catch (error) {
    await prisma.retentionRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorCode: "RUN_FAILED",
      },
    });
    throw error;
  }
}
