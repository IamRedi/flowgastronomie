import {
  assertStaffPermission,
  hasStaffPermission,
  permissionForOrderTransition,
  type StaffRadarSignal,
  type StaffRole,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import {
  requireActiveShift,
  type StaffActor,
} from "./staff-work-repository.js";

export type StaffRadarRepository = {
  listOpen(input: {
    tenantId: string;
    venueId: string;
    membershipId: string;
  }): Promise<StaffRadarSignal[]>;
  listAvailableStaff(input: StaffActor): Promise<
    Array<{
      membershipId: string;
      displayName: string;
      role: StaffRole;
    }>
  >;
  claim(input: { staff: StaffActor; signalId: string }): Promise<boolean>;
  assign(input: {
    staff: StaffActor;
    signalId: string;
    membershipId: string;
  }): Promise<boolean>;
  release(input: { staff: StaffActor; signalId: string }): Promise<boolean>;
  acknowledge(input: { staff: StaffActor; signalId: string }): Promise<boolean>;
};

export class RadarAssignmentConflictError extends Error {
  constructor(message = "This task was already taken by another worker") {
    super(message);
    this.name = "RadarAssignmentConflictError";
  }
}

function canHandleSignal(
  role: StaffRole,
  signal: { type: string; order: { status: string } | null },
) {
  if (!signal.order) {
    return signal.type === "BILL_REQUEST"
      ? hasStaffPermission(role, "PAYMENT_RECORD")
      : hasStaffPermission(role, "SIGNAL_ACKNOWLEDGE");
  }
  const nextByStatus = {
    READY: "SERVED",
  } as const;
  const next = nextByStatus[signal.order.status as keyof typeof nextByStatus];
  return next
    ? hasStaffPermission(role, permissionForOrderTransition(next))
    : false;
}

function assertCanHandleSignal(
  role: StaffRole,
  signal: { type: string; order: { status: string } | null },
) {
  if (!signal.order) {
    assertStaffPermission(
      role,
      signal.type === "BILL_REQUEST" ? "PAYMENT_RECORD" : "SIGNAL_ACKNOWLEDGE",
    );
    return;
  }
  const nextByStatus = {
    READY: "SERVED",
  } as const;
  const next = nextByStatus[signal.order.status as keyof typeof nextByStatus];
  if (next) assertStaffPermission(role, permissionForOrderTransition(next));
}

export const staffRadarRepository: StaffRadarRepository = {
  async listOpen({ tenantId, venueId, membershipId }) {
    const now = Date.now();
    const signals = await prisma.serviceSignal.findMany({
      where: {
        tenantId,
        venueId,
        OR: [
          { acknowledgedAt: null },
          {
            order: {
              is: { status: { notIn: ["SERVED", "CANCELLED"] } },
            },
          },
        ],
      },
      orderBy: { createdAt: "asc" },
      include: {
        table: { include: { area: true } },
        order: {
          include: { items: true, productionTickets: true },
        },
        tableSession: {
          include: {
            orders: {
              where: { status: { not: "CANCELLED" } },
              select: { totalMinor: true, currency: true },
            },
            paymentRecords: {
              where: { status: "RECORDED" },
              select: { amountMinor: true },
            },
          },
        },
      },
    });
    const assignedUsers = await prisma.user.findMany({
      where: {
        tenantId,
        id: {
          in: signals
            .flatMap((signal) => [
              signal.assignedUserId,
              ...(signal.order?.productionTickets.map(
                (ticket) => ticket.assignedUserId,
              ) ?? []),
              signal.order?.serviceOwnerUserId,
            ])
            .filter((userId): userId is string => Boolean(userId)),
        },
      },
      select: { id: true, displayName: true },
    });
    const displayNameByUserId = new Map(
      assignedUsers.map((user) => [user.id, user.displayName]),
    );

    return signals.map((signal) => {
      const dueMinor = signal.tableSession.orders.reduce(
        (total, order) => total + order.totalMinor,
        0,
      );
      const paidMinor = signal.tableSession.paymentRecords.reduce(
        (total, payment) => total + payment.amountMinor,
        0,
      );
      return {
        id: signal.id,
        tableSessionId: signal.tableSessionId,
        tableLabel: signal.table.label,
        area: signal.table.area?.name ?? null,
        type: signal.type,
        createdAt: signal.createdAt,
        waitingSeconds: Math.max(
          0,
          Math.floor((now - signal.createdAt.getTime()) / 1_000),
        ),
        assignment:
          signal.assignedMembershipId &&
          signal.assignedUserId &&
          signal.claimedAt
            ? {
                membershipId: signal.assignedMembershipId,
                displayName:
                  displayNameByUserId.get(signal.assignedUserId) ?? "Staff",
                claimedAt: signal.claimedAt,
                assignedByManager:
                  signal.assignedByUserId !== signal.assignedUserId,
                isMine: signal.assignedMembershipId === membershipId,
              }
            : null,
        balance: {
          dueMinor,
          paidMinor,
          outstandingMinor: Math.max(0, dueMinor - paidMinor),
          currency: signal.tableSession.orders[0]?.currency ?? "EUR",
        },
        order: signal.order
          ? {
              id: signal.order.id,
              // Radar signals are session-bound, so their orders always carry
              // the signal's own session even though the column is now
              // optional for staff POS takeaway orders.
              tableSessionId:
                signal.order.tableSessionId ?? signal.tableSessionId,
              status: signal.order.status,
              version: signal.order.version,
              itemCount: signal.order.items.reduce(
                (total, item) => total + item.quantity,
                0,
              ),
              totalMinor: signal.order.totalMinor,
              currency: signal.order.currency,
              source: signal.order.source,
              serviceOwner:
                signal.order.serviceOwnerMembershipId &&
                signal.order.serviceOwnerUserId
                  ? {
                      membershipId: signal.order.serviceOwnerMembershipId,
                      displayName:
                        displayNameByUserId.get(
                          signal.order.serviceOwnerUserId,
                        ) ?? "Staff",
                      isMine:
                        signal.order.serviceOwnerMembershipId === membershipId,
                    }
                  : null,
              productionTickets: signal.order.productionTickets.map(
                (ticket) => ({
                  id: ticket.id,
                  station: ticket.station,
                  status: ticket.status,
                  version: ticket.version,
                  itemCount: signal
                    .order!.items.filter(
                      (item) => item.station === ticket.station,
                    )
                    .reduce((total, item) => total + item.quantity, 0),
                  itemNames: signal
                    .order!.items.filter(
                      (item) => item.station === ticket.station,
                    )
                    .map((item) => item.productName),
                  subtotalMinor: signal
                    .order!.items.filter(
                      (item) => item.station === ticket.station,
                    )
                    .reduce(
                      (total, item) =>
                        total + item.unitPriceMinor * item.quantity,
                      0,
                    ),
                  assignment:
                    ticket.assignedMembershipId && ticket.assignedUserId
                      ? {
                          membershipId: ticket.assignedMembershipId,
                          displayName:
                            displayNameByUserId.get(ticket.assignedUserId) ??
                            "Staff",
                          isMine: ticket.assignedMembershipId === membershipId,
                        }
                      : null,
                }),
              ),
            }
          : null,
      };
    });
  },

  async listAvailableStaff(staff) {
    const shifts = await prisma.staffShift.findMany({
      where: {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        status: "OPEN",
        membership: { active: true },
      },
      orderBy: { membership: { user: { displayName: "asc" } } },
      include: {
        membership: {
          include: { user: { select: { displayName: true } } },
        },
      },
    });
    return shifts.map((shift) => ({
      membershipId: shift.membershipId,
      displayName: shift.membership.user.displayName,
      role: shift.membership.role,
    }));
  },

  async claim({ staff, signalId }) {
    return prisma.$transaction(async (transaction) => {
      const shift = await requireActiveShift(transaction, staff);
      const signal = await transaction.serviceSignal.findFirst({
        where: {
          id: signalId,
          tenantId: staff.tenantId,
          venueId: staff.venueId,
        },
        include: { order: { select: { status: true } } },
      });
      if (!signal) return false;
      assertCanHandleSignal(staff.role, signal);
      const result = await transaction.serviceSignal.updateMany({
        where: {
          id: signal.id,
          OR: [
            { assignedMembershipId: null },
            { assignedMembershipId: staff.membershipId },
          ],
        },
        data: {
          assignedMembershipId: staff.membershipId,
          assignedUserId: staff.userId,
          assignedShiftId: shift.id,
          assignedByUserId: staff.userId,
          claimedAt: new Date(),
        },
      });
      if (!result.count) throw new RadarAssignmentConflictError();
      await transaction.auditEvent.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
          actorShiftId: shift.id,
          action: "SERVICE_TASK_CLAIMED",
          entityType: "ServiceSignal",
          entityId: signal.id,
          metadata: {},
        },
      });
      return true;
    });
  },

  async assign({ staff, signalId, membershipId }) {
    assertStaffPermission(staff.role, "TABLE_ASSIGN");
    return prisma.$transaction(async (transaction) => {
      const [signal, targetShift] = await Promise.all([
        transaction.serviceSignal.findFirst({
          where: {
            id: signalId,
            tenantId: staff.tenantId,
            venueId: staff.venueId,
          },
          include: { order: { select: { status: true } } },
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
      if (!signal || !targetShift) return false;
      if (!canHandleSignal(targetShift.membership.role, signal)) {
        throw new RadarAssignmentConflictError(
          "The selected worker role cannot perform this task",
        );
      }
      await transaction.serviceSignal.update({
        where: { id: signal.id },
        data: {
          assignedMembershipId: targetShift.membershipId,
          assignedUserId: targetShift.userId,
          assignedShiftId: targetShift.id,
          assignedByUserId: staff.userId,
          claimedAt: new Date(),
        },
      });
      await transaction.auditEvent.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
          action: "SERVICE_TASK_ASSIGNED",
          entityType: "ServiceSignal",
          entityId: signal.id,
          metadata: { assignedMembershipId: targetShift.membershipId },
        },
      });
      return true;
    });
  },

  async release({ staff, signalId }) {
    const signal = await prisma.serviceSignal.findFirst({
      where: {
        id: signalId,
        tenantId: staff.tenantId,
        venueId: staff.venueId,
      },
    });
    if (!signal) return false;
    const canManage = hasStaffPermission(staff.role, "TABLE_ASSIGN");
    if (!canManage && signal.assignedMembershipId !== staff.membershipId) {
      throw new RadarAssignmentConflictError(
        "Only the assigned worker or a manager can release this task",
      );
    }
    const result = await prisma.serviceSignal.updateMany({
      where: { id: signal.id, assignedMembershipId: { not: null } },
      data: {
        assignedMembershipId: null,
        assignedUserId: null,
        assignedShiftId: null,
        assignedByUserId: null,
        claimedAt: null,
      },
    });
    return result.count === 1;
  },

  async acknowledge({ staff, signalId }) {
    return prisma.$transaction(async (transaction) => {
      const shift = await requireActiveShift(transaction, staff);
      const acknowledgedAt = new Date();
      const result = await transaction.serviceSignal.updateMany({
        where: {
          id: signalId,
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          acknowledgedAt: null,
          OR: [
            { assignedMembershipId: null },
            { assignedMembershipId: staff.membershipId },
          ],
        },
        data: {
          acknowledgedAt,
          acknowledgedByUserId: staff.userId,
          acknowledgedByShiftId: shift.id,
          assignedMembershipId: staff.membershipId,
          assignedUserId: staff.userId,
          assignedShiftId: shift.id,
          assignedByUserId: staff.userId,
          claimedAt: acknowledgedAt,
        },
      });
      if (result.count === 1) {
        await transaction.auditEvent.create({
          data: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            actorUserId: staff.userId,
            actorMembershipId: staff.membershipId,
            actorShiftId: shift.id,
            action: "TABLE_REQUEST_ACKNOWLEDGED",
            entityType: "ServiceSignal",
            entityId: signalId,
            metadata: {},
          },
        });
      }
      return result.count === 1;
    });
  },
};
