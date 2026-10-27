import {
  assertStaffPermission,
  operationalSourceFromOnlineFulfillment,
  operationalStatusFromOnlineOrder,
  operationalStatusFromTableOrder,
  type OperationalOrder,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import type { StaffIdentity } from "./staff-auth-repository.js";

export type OperationalOrderRepository = {
  listForStaff(staff: StaffIdentity): Promise<OperationalOrder[]>;
};

function actor(userId: string | null, membershipId: string | null) {
  if (!userId || !membershipId) return null;
  return { userId, membershipId };
}

function shiftActor(
  userId: string | null,
  membershipId: string | null,
  shiftId: string | null,
) {
  if (!userId || !membershipId || !shiftId) return null;
  return { userId, membershipId, shiftId };
}

export const operationalOrderRepository: OperationalOrderRepository = {
  async listForStaff(staff) {
    assertStaffPermission(staff.role, "OPERATIONAL_ORDER_VIEW");

    const [tableOrders, onlineOrders] = await Promise.all([
      prisma.order.findMany({
        where: { tenantId: staff.tenantId, venueId: staff.venueId },
        select: {
          id: true,
          source: true,
          status: true,
          totalMinor: true,
          currency: true,
          createdAt: true,
          updatedAt: true,
          guestId: true,
          tableSessionId: true,
          createdByUserId: true,
          createdByMembershipId: true,
          createdByShiftId: true,
          serviceOwnerUserId: true,
          serviceOwnerMembershipId: true,
          serviceOwnerShiftId: true,
          tableSession: { select: { table: { select: { label: true } } } },
          items: {
            select: {
              productId: true,
              productName: true,
              quantity: true,
              unitPriceMinor: true,
              station: true,
              notes: true,
              variantId: true,
              variantName: true,
              modifiers: {
                select: {
                  modifierOptionId: true,
                  groupName: true,
                  optionName: true,
                  priceDeltaMinor: true,
                },
              },
            },
          },
          productionTickets: {
            select: { station: true, status: true, updatedAt: true },
          },
          statusEvents: {
            orderBy: { createdAt: "asc" },
            select: {
              status: true,
              kind: true,
              createdAt: true,
              actorUserId: true,
              actorMembershipId: true,
            },
          },
        },
      }),
      prisma.onlineOrder.findMany({
        where: { tenantId: staff.tenantId, venueId: staff.venueId },
        select: {
          id: true,
          referenceCode: true,
          fulfillmentType: true,
          status: true,
          totalMinor: true,
          currency: true,
          createdAt: true,
          updatedAt: true,
          requestedFor: true,
          decidedByUserId: true,
          decidedByMembershipId: true,
          items: {
            select: {
              productId: true,
              productName: true,
              quantity: true,
              unitPriceMinor: true,
              station: true,
              notes: true,
              variantId: true,
              variantName: true,
              modifiers: {
                select: {
                  modifierOptionId: true,
                  groupName: true,
                  optionName: true,
                  priceDeltaMinor: true,
                },
              },
            },
          },
          productionTickets: {
            select: { station: true, status: true, updatedAt: true },
          },
          statusEvents: {
            orderBy: { createdAt: "asc" },
            select: {
              status: true,
              createdAt: true,
              actorUserId: true,
              actorMembershipId: true,
            },
          },
        },
      }),
    ]);

    const tableProjection: OperationalOrder[] = tableOrders.map((order) => ({
      id: order.id,
      reference: order.id,
      source:
        order.source === "STAFF_TABLET"
          ? "TABLE_STAFF_TABLET"
          : "TABLE_GUEST_QR",
      fulfillment: order.tableSessionId ? "DINE_IN" : "PICKUP",
      status: operationalStatusFromTableOrder(order.status),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      requestedFor: null,
      totals: { totalMinor: order.totalMinor, currency: order.currency },
      customerLink: { kind: "TABLE_GUEST", id: order.guestId },
      table:
        order.tableSession && order.tableSessionId
          ? {
              sessionId: order.tableSessionId,
              label: order.tableSession.table.label,
            }
          : null,
      payment: { status: "NOT_RECORDED" },
      items: order.items,
      production: order.productionTickets,
      statusHistory: order.statusEvents.length
        ? order.statusEvents.map((event) => ({
            status: operationalStatusFromTableOrder(event.status),
            occurredAt: event.createdAt,
            actor: actor(event.actorUserId, event.actorMembershipId),
          }))
        : [
            {
              status: operationalStatusFromTableOrder(order.status),
              occurredAt: order.updatedAt,
              actor: actor(
                order.serviceOwnerUserId,
                order.serviceOwnerMembershipId,
              ),
            },
          ],
      statusHistoryCoverage: order.statusEvents.some(
        (event) => event.kind === "INITIAL",
      )
        ? "RECORDED_EVENTS"
        : "CURRENT_STATE_ONLY",
      actors: {
        created: shiftActor(
          order.createdByUserId,
          order.createdByMembershipId,
          order.createdByShiftId,
        ),
        serviceOwner: shiftActor(
          order.serviceOwnerUserId,
          order.serviceOwnerMembershipId,
          order.serviceOwnerShiftId,
        ),
        decision: null,
      },
    }));
    const onlineProjection: OperationalOrder[] = onlineOrders.map((order) => ({
      id: order.id,
      reference: order.referenceCode,
      source: operationalSourceFromOnlineFulfillment(order.fulfillmentType),
      fulfillment: order.fulfillmentType,
      status: operationalStatusFromOnlineOrder(order.status),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      requestedFor: order.requestedFor,
      totals: { totalMinor: order.totalMinor, currency: order.currency },
      customerLink: { kind: "ORDER_CONTACT", id: null },
      table: null,
      payment: { status: "NOT_RECORDED" },
      items: order.items,
      production: order.productionTickets,
      statusHistory: order.statusEvents.map((event) => ({
        status: operationalStatusFromOnlineOrder(event.status),
        occurredAt: event.createdAt,
        actor: actor(event.actorUserId, event.actorMembershipId),
      })),
      statusHistoryCoverage: "RECORDED_EVENTS",
      actors: {
        created: null,
        serviceOwner: null,
        decision: actor(order.decidedByUserId, order.decidedByMembershipId),
      },
    }));

    return [...tableProjection, ...onlineProjection].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
  },
};
