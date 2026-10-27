import type { ProductionTicketStatus, StationType } from "@prisma/client";
import {
  assertStaffPermission,
  StaffPermissionDeniedError,
  type StaffRole,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import type { StaffIdentity } from "./staff-auth-repository.js";
import { requireActiveShift } from "./staff-work-repository.js";

export class ProductionTicketNotFoundError extends Error {
  constructor() {
    super("The production ticket was not found in this venue");
    this.name = "ProductionTicketNotFoundError";
  }
}

export class ProductionTicketConflictError extends Error {
  constructor(message = "The production ticket was updated by another worker") {
    super(message);
    this.name = "ProductionTicketConflictError";
  }
}

function canWorkStation(role: StaffRole, station: StationType) {
  return (
    role === "OWNER" ||
    role === "MANAGER" ||
    (role === "BAR" && station === "BAR") ||
    (role === "KITCHEN" && ["KITCHEN", "DESSERT"].includes(station))
  );
}

function assertStationRole(role: StaffRole, station: StationType) {
  if (!canWorkStation(role, station)) {
    throw new StaffPermissionDeniedError(role, "ORDER_PREPARE");
  }
}

export type StaffProductionRepository = {
  transition(input: {
    staff: StaffIdentity;
    ticketId: string;
    status: Exclude<ProductionTicketStatus, "NEW">;
    expectedVersion: number;
  }): Promise<{
    id: string;
    status: ProductionTicketStatus;
    version: number;
    orderStatus: string;
  }>;
  assign(input: {
    staff: StaffIdentity;
    ticketId: string;
    membershipId: string;
  }): Promise<void>;
};

export const staffProductionRepository: StaffProductionRepository = {
  async transition({ staff, ticketId, status, expectedVersion }) {
    return prisma.$transaction(async (transaction) => {
      const shift = await requireActiveShift(transaction, staff);
      const ticket = await transaction.orderStationTicket.findFirst({
        where: {
          id: ticketId,
          tenantId: staff.tenantId,
          venueId: staff.venueId,
        },
        include: {
          order: {
            select: {
              serviceOwnerMembershipId: true,
              serviceOwnerUserId: true,
              serviceOwnerShiftId: true,
            },
          },
        },
      });
      if (!ticket) throw new ProductionTicketNotFoundError();
      if (status === "SERVED") {
        assertStaffPermission(staff.role, "ORDER_SERVE");
      } else {
        assertStationRole(staff.role, ticket.station);
      }

      const validTransition =
        (ticket.status === "NEW" && status === "PREPARING") ||
        (ticket.status === "PREPARING" && status === "READY") ||
        (ticket.status === "READY" && status === "SERVED");
      if (!validTransition) throw new ProductionTicketConflictError();
      if (
        ticket.assignedMembershipId &&
        ticket.assignedMembershipId !== staff.membershipId &&
        !["OWNER", "MANAGER"].includes(staff.role)
      ) {
        throw new ProductionTicketConflictError(
          "This station ticket belongs to another worker",
        );
      }

      const changed = await transaction.orderStationTicket.updateMany({
        where: {
          id: ticket.id,
          version: expectedVersion,
          status: ticket.status,
        },
        data: {
          status,
          version: { increment: 1 },
          assignedMembershipId:
            status === "READY"
              ? ticket.order.serviceOwnerMembershipId
              : staff.membershipId,
          assignedUserId:
            status === "READY" ? ticket.order.serviceOwnerUserId : staff.userId,
          assignedShiftId:
            status === "READY" ? ticket.order.serviceOwnerShiftId : shift.id,
          assignedByUserId:
            status === "READY"
              ? ticket.order.serviceOwnerUserId
              : (ticket.assignedByUserId ?? staff.userId),
          claimedAt:
            status === "READY"
              ? ticket.order.serviceOwnerMembershipId
                ? new Date()
                : null
              : (ticket.claimedAt ?? new Date()),
          ...(status === "READY" ? { readyAt: new Date() } : {}),
          ...(status === "SERVED" ? { servedAt: new Date() } : {}),
        },
      });
      if (!changed.count) throw new ProductionTicketConflictError();

      const [productionOpenCount, unservedCount] = await Promise.all([
        transaction.orderStationTicket.count({
          where: {
            orderId: ticket.orderId,
            status: { in: ["NEW", "PREPARING"] },
          },
        }),
        transaction.orderStationTicket.count({
          where: { orderId: ticket.orderId, status: { not: "SERVED" } },
        }),
      ]);
      const orderStatus =
        unservedCount === 0
          ? "SERVED"
          : productionOpenCount === 0
            ? "READY"
            : "PREPARING";
      await transaction.order.update({
        where: { id: ticket.orderId },
        data: { status: orderStatus, version: { increment: 1 } },
      });
      if (orderStatus === "SERVED") {
        await transaction.serviceSignal.updateMany({
          where: { orderId: ticket.orderId },
          data: {
            acknowledgedAt: new Date(),
            acknowledgedByUserId: staff.userId,
            acknowledgedByShiftId: shift.id,
          },
        });
      }

      await transaction.auditEvent.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
          actorShiftId: shift.id,
          action:
            status === "SERVED"
              ? "STATION_TICKET_SERVED"
              : status === "READY"
                ? "PRODUCTION_TICKET_READY"
                : "PRODUCTION_TICKET_STARTED",
          entityType: "OrderStationTicket",
          entityId: ticket.id,
          metadata: { station: ticket.station, orderId: ticket.orderId },
        },
      });

      return {
        id: ticket.id,
        status,
        version: expectedVersion + 1,
        orderStatus,
      };
    });
  },

  async assign({ staff, ticketId, membershipId }) {
    assertStaffPermission(staff.role, "TABLE_ASSIGN");
    await prisma.$transaction(async (transaction) => {
      const [ticket, targetShift] = await Promise.all([
        transaction.orderStationTicket.findFirst({
          where: {
            id: ticketId,
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            status: { not: "SERVED" },
          },
        }),
        transaction.staffShift.findFirst({
          where: {
            membershipId,
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            status: "OPEN",
            membership: { active: true },
          },
          include: { membership: true },
        }),
      ]);
      if (!ticket || !targetShift) throw new ProductionTicketNotFoundError();
      const targetCanHandle =
        ticket.status === "READY"
          ? ["OWNER", "MANAGER", "WAITER"].includes(targetShift.membership.role)
          : canWorkStation(targetShift.membership.role, ticket.station);
      if (!targetCanHandle) {
        throw new ProductionTicketConflictError(
          "The selected worker cannot work this station",
        );
      }
      await transaction.orderStationTicket.update({
        where: { id: ticket.id },
        data: {
          assignedMembershipId: targetShift.membershipId,
          assignedUserId: targetShift.userId,
          assignedShiftId: targetShift.id,
          assignedByUserId: staff.userId,
          claimedAt: new Date(),
        },
      });
    });
  },
};
