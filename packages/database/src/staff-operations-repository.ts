import type { OrderStatus } from "@prisma/client";
import {
  assertStaffPermission,
  CounterSaleError,
  operationalSourceFromTableOrder,
  operationalStatusFromTableOrder,
  permissionForOrderTransition,
  transitionOrder,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import { publishOperationalOrderEvent } from "./operational-order-event.js";
import {
  requireActiveShift,
  type StaffActor,
} from "./staff-work-repository.js";

export class StaffResourceNotFoundError extends Error {
  constructor(resource: "order" | "session") {
    super(`The ${resource} was not found in this venue`);
    this.name = "StaffResourceNotFoundError";
  }
}

export class ConcurrentOrderUpdateError extends Error {
  constructor() {
    super("The order was updated by another staff member");
    this.name = "ConcurrentOrderUpdateError";
  }
}

export class SessionHasOpenOrdersError extends Error {
  constructor() {
    super("The table session still has active orders");
    this.name = "SessionHasOpenOrdersError";
  }
}

export class SessionPaymentOutstandingError extends Error {
  constructor() {
    super("The table session still has an outstanding balance");
    this.name = "SessionPaymentOutstandingError";
  }
}

export type StaffOrderResult = {
  id: string;
  status: OrderStatus;
  version: number;
  updatedAt: Date;
};

export type StaffOperationsRepository = {
  transitionOrder(input: {
    staff: StaffActor;
    orderId: string;
    nextStatus: OrderStatus;
    expectedVersion: number;
  }): Promise<StaffOrderResult>;
  closeTableSession(input: {
    staff: StaffActor;
    sessionId: string;
  }): Promise<{ id: string; status: "CLOSED"; closedAt: Date }>;
  attributeTabletOrder(input: {
    staff: StaffActor;
    orderId: string;
  }): Promise<{ id: string; source: "STAFF_TABLET" }>;
};

export const staffOperationsRepository: StaffOperationsRepository = {
  async transitionOrder({ staff, orderId, nextStatus, expectedVersion }) {
    assertStaffPermission(staff.role, permissionForOrderTransition(nextStatus));

    return prisma.$transaction(async (transaction) => {
      const shift = await requireActiveShift(transaction, staff);
      await transaction.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} AND "tenantId" = ${staff.tenantId} AND "venueId" = ${staff.venueId} FOR UPDATE`;
      const order = await transaction.order.findFirst({
        where: {
          id: orderId,
          tenantId: staff.tenantId,
          venueId: staff.venueId,
        },
      });

      if (!order) throw new StaffResourceNotFoundError("order");
      if (
        nextStatus === "CANCELLED" &&
        (await transaction.paymentRecord.findFirst({
          where: {
            orderId: order.id,
            tenantId: staff.tenantId,
            venueId: staff.venueId,
          },
        }))
      )
        throw new CounterSaleError(
          "FINALIZED_PAYMENT",
          "Paid orders require a new correction document; cancellation is unavailable in P2",
        );
      const status = transitionOrder(order.status, nextStatus);

      const updated = await transaction.order.updateMany({
        where: {
          id: order.id,
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          version: expectedVersion,
          status: order.status,
        },
        data: {
          status,
          version: { increment: 1 },
        },
      });

      if (updated.count !== 1) throw new ConcurrentOrderUpdateError();

      await transaction.orderStatusEvent.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          orderId: order.id,
          status,
          kind: "TRANSITION",
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
          actorShiftId: shift.id,
        },
      });
      await publishOperationalOrderEvent(transaction, {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        orderId: order.id,
        orderKind: "TABLE",
        type: "ORDER_STATUS_CHANGED",
        source: operationalSourceFromTableOrder(order.source),
        fulfillment: "DINE_IN",
        status: operationalStatusFromTableOrder(status),
        totalMinor: order.totalMinor,
        currency: order.currency,
        actor: {
          userId: staff.userId,
          membershipId: staff.membershipId,
          shiftId: shift.id,
        },
      });

      const ownership = await transaction.serviceSignal.findFirst({
        where: { orderId: order.id },
        select: { assignedMembershipId: true },
      });
      if (
        ownership?.assignedMembershipId &&
        ownership.assignedMembershipId !== staff.membershipId
      ) {
        throw new ConcurrentOrderUpdateError();
      }

      if (status === "ACCEPTED") {
        await transaction.serviceSignal.updateMany({
          where: {
            orderId: order.id,
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            acknowledgedAt: null,
          },
          data: { acknowledgedAt: new Date() },
        });
      }

      await transaction.serviceSignal.updateMany({
        where: { orderId: order.id },
        data: {
          assignedMembershipId: null,
          assignedUserId: null,
          assignedShiftId: null,
          assignedByUserId: null,
          claimedAt: null,
        },
      });

      const result = await transaction.order.findUniqueOrThrow({
        where: { id: order.id },
        select: { id: true, status: true, version: true, updatedAt: true },
      });

      await transaction.auditEvent.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
          actorShiftId: shift.id,
          action: "ORDER_STATUS_CHANGED",
          entityType: "Order",
          entityId: order.id,
          metadata: { fromStatus: order.status, toStatus: status },
        },
      });

      return result;
    });
  },

  async closeTableSession({ staff, sessionId }) {
    assertStaffPermission(staff.role, "SESSION_CLOSE");

    return prisma.$transaction(async (transaction) => {
      const shift = await requireActiveShift(transaction, staff);
      const session = await transaction.tableSession.findFirst({
        where: {
          id: sessionId,
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          status: "OPEN",
        },
        include: {
          orders: {
            select: { id: true, status: true, totalMinor: true },
          },
          paymentRecords: {
            where: { status: "RECORDED" },
            select: { amountMinor: true },
          },
        },
      });

      if (!session) throw new StaffResourceNotFoundError("session");
      if (
        session.orders.some(
          (order) => !["SERVED", "CANCELLED"].includes(order.status),
        )
      ) {
        throw new SessionHasOpenOrdersError();
      }
      const due = session.orders
        .filter((order) => order.status !== "CANCELLED")
        .reduce((sum, order) => sum + order.totalMinor, 0);
      const paid = session.paymentRecords.reduce(
        (sum, payment) => sum + payment.amountMinor,
        0,
      );
      if (paid < due) throw new SessionPaymentOutstandingError();

      const closedAt = new Date();
      const closed = await transaction.tableSession.update({
        where: { id: session.id },
        data: {
          status: "CLOSED",
          activeTableKey: null,
          closedAt,
        },
      });

      await transaction.serviceSignal.updateMany({
        where: {
          tableSessionId: session.id,
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          acknowledgedAt: null,
        },
        data: { acknowledgedAt: closedAt },
      });

      await transaction.auditEvent.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
          actorShiftId: shift.id,
          action: "TABLE_SESSION_CLOSED",
          entityType: "TableSession",
          entityId: session.id,
          metadata: {},
        },
      });

      return { id: closed.id, status: "CLOSED", closedAt };
    });
  },

  async attributeTabletOrder({ staff, orderId }) {
    assertStaffPermission(staff.role, "ORDER_SERVE");
    return prisma.$transaction(async (transaction) => {
      const shift = await requireActiveShift(transaction, staff);
      const order = await transaction.order.findFirst({
        where: {
          id: orderId,
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          tableSession: { status: "OPEN" },
        },
      });
      if (!order) throw new StaffResourceNotFoundError("order");
      await transaction.order.update({
        where: { id: order.id },
        data: {
          source: "STAFF_TABLET",
          createdByUserId: staff.userId,
          createdByMembershipId: staff.membershipId,
          createdByShiftId: shift.id,
          serviceOwnerUserId: staff.userId,
          serviceOwnerMembershipId: staff.membershipId,
          serviceOwnerShiftId: shift.id,
        },
      });
      if (order.status === "READY") {
        await transaction.serviceSignal.updateMany({
          where: { orderId: order.id },
          data: {
            assignedMembershipId: staff.membershipId,
            assignedUserId: staff.userId,
            assignedShiftId: shift.id,
            assignedByUserId: staff.userId,
            claimedAt: new Date(),
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
          action: "TABLET_ORDER_CREATED",
          entityType: "Order",
          entityId: order.id,
          metadata: { tableSessionId: order.tableSessionId },
        },
      });
      return { id: order.id, source: "STAFF_TABLET" };
    });
  },
};
