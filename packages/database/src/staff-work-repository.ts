import type { PaymentMethod, Prisma } from "@prisma/client";
import {
  assertStaffPermission,
  businessDateForInstant,
  businessDayUtcRange,
  hasStaffPermission,
  CounterSaleError,
  type StaffPaymentHistory,
  type StaffRole,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";

export type StaffActor = {
  tenantId: string;
  venueId: string;
  userId: string;
  membershipId: string;
  role: StaffRole;
};

export class ActiveShiftRequiredError extends Error {
  constructor() {
    super("An active staff shift is required for this action");
    this.name = "ActiveShiftRequiredError";
  }
}

export class ActiveShiftExistsError extends Error {
  constructor() {
    super("This staff member already has an active shift");
    this.name = "ActiveShiftExistsError";
  }
}

export class WorkResourceNotFoundError extends Error {
  constructor(resource: "shift" | "table session" | "payment") {
    super(`The ${resource} was not found in this venue`);
    this.name = "WorkResourceNotFoundError";
  }
}

export class PaymentBalanceError extends Error {
  constructor() {
    super("The payment amount exceeds the table session balance");
    this.name = "PaymentBalanceError";
  }
}

export async function requireActiveShift(
  transaction: Prisma.TransactionClient,
  staff: StaffActor,
) {
  const shift = await transaction.staffShift.findFirst({
    where: {
      activeShiftKey: `${staff.venueId}:${staff.userId}`,
      tenantId: staff.tenantId,
      venueId: staff.venueId,
      userId: staff.userId,
      membershipId: staff.membershipId,
      status: "OPEN",
    },
  });
  if (!shift) throw new ActiveShiftRequiredError();
  return shift;
}

function auditData(
  staff: StaffActor,
  shiftId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Prisma.InputJsonValue = {},
) {
  return {
    tenantId: staff.tenantId,
    venueId: staff.venueId,
    actorUserId: staff.userId,
    actorMembershipId: staff.membershipId,
    actorShiftId: shiftId,
    action,
    entityType,
    entityId,
    metadata,
  };
}

export type StaffShiftSummary = {
  id: string;
  status: "OPEN" | "CLOSED";
  startedAt: Date;
  endedAt: Date | null;
  recordedPaymentMinor: number;
  actionCount: number;
};

export type StaffWorkRepository = {
  currentShift(staff: StaffActor): Promise<StaffShiftSummary | null>;
  listPayments(input: {
    staff: StaffActor;
    date?: string | undefined;
  }): Promise<StaffPaymentHistory>;
  startShift(input: {
    staff: StaffActor;
    openingNote?: string | undefined;
  }): Promise<StaffShiftSummary>;
  endShift(input: {
    staff: StaffActor;
    closingNote?: string | undefined;
  }): Promise<StaffShiftSummary>;
  recordPayment(input: {
    staff: StaffActor;
    tableSessionId: string;
    amountMinor: number;
    method: PaymentMethod;
    idempotencyKey: string;
    externalReference?: string | undefined;
  }): Promise<{
    id: string;
    amountMinor: number;
    currency: string;
    method: PaymentMethod;
    status: "RECORDED" | "VOIDED";
    recordedAt: Date;
  }>;
  voidPayment(input: {
    staff: StaffActor;
    paymentId: string;
    reason: string;
  }): Promise<{ id: string; status: "VOIDED"; voidedAt: Date }>;
};

async function summarizeShift(
  transaction: Prisma.TransactionClient,
  shift: {
    id: string;
    status: "OPEN" | "CLOSED";
    startedAt: Date;
    endedAt: Date | null;
  },
): Promise<StaffShiftSummary> {
  const [payments, actionCount] = await Promise.all([
    transaction.paymentRecord.aggregate({
      where: { recordedByShiftId: shift.id, status: "RECORDED" },
      _sum: { amountMinor: true },
    }),
    transaction.auditEvent.count({ where: { actorShiftId: shift.id } }),
  ]);
  return {
    ...shift,
    recordedPaymentMinor: payments._sum.amountMinor ?? 0,
    actionCount,
  };
}

export const staffWorkRepository: StaffWorkRepository = {
  async currentShift(staff) {
    assertStaffPermission(staff.role, "SHIFT_SELF");
    const shift = await prisma.staffShift.findFirst({
      where: {
        activeShiftKey: `${staff.venueId}:${staff.userId}`,
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        userId: staff.userId,
        status: "OPEN",
      },
      select: { id: true, status: true, startedAt: true, endedAt: true },
    });
    return shift ? summarizeShift(prisma, shift) : null;
  },

  async listPayments({ staff, date }) {
    const canViewVenue = hasStaffPermission(staff.role, "PAYMENT_VOID");
    if (!canViewVenue) assertStaffPermission(staff.role, "PAYMENT_RECORD");
    const venue = await prisma.venue.findFirstOrThrow({
      where: { id: staff.venueId, tenantId: staff.tenantId },
      select: { timezone: true, currency: true },
    });
    const paymentDate =
      date ?? businessDateForInstant(new Date(), venue.timezone);
    const range = businessDayUtcRange(paymentDate, venue.timezone);
    const payments = await prisma.paymentRecord.findMany({
      where: {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        recordedAt: { gte: range.startsAt, lt: range.endsAt },
        ...(canViewVenue ? {} : { recordedByMembershipId: staff.membershipId }),
      },
      orderBy: { recordedAt: "desc" },
      include: {
        tableSession: {
          include: {
            table: {
              include: { area: { select: { name: true } } },
            },
          },
        },
        recordedByShift: {
          include: {
            membership: {
              include: { user: { select: { displayName: true } } },
            },
          },
        },
        voidedByShift: {
          include: {
            membership: {
              include: { user: { select: { displayName: true } } },
            },
          },
        },
      },
    });
    return {
      date: paymentDate,
      timezone: venue.timezone,
      currency: venue.currency,
      scope: canViewVenue ? "VENUE" : "SELF",
      payments: payments.map((payment) => ({
        id: payment.id,
        tableLabel: payment.tableSession?.table.label ?? "Counter",
        area: payment.tableSession?.table.area?.name ?? null,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        method: payment.method,
        status: payment.status,
        recordedAt: payment.recordedAt.toISOString(),
        recordedBy: {
          membershipId: payment.recordedByMembershipId,
          displayName: payment.recordedByShift.membership.user.displayName,
        },
        voidedAt: payment.voidedAt?.toISOString() ?? null,
        voidedBy: payment.voidedByShift
          ? {
              membershipId: payment.voidedByShift.membershipId,
              displayName: payment.voidedByShift.membership.user.displayName,
            }
          : null,
        voidReason: payment.voidReason,
        externalReference: payment.externalReference,
        canVoid: canViewVenue && payment.status === "RECORDED",
      })),
    };
  },

  async startShift({ staff, openingNote }) {
    assertStaffPermission(staff.role, "SHIFT_SELF");
    try {
      return await prisma.$transaction(async (transaction) => {
        const shift = await transaction.staffShift.create({
          data: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            userId: staff.userId,
            membershipId: staff.membershipId,
            activeShiftKey: `${staff.venueId}:${staff.userId}`,
            ...(openingNote ? { openingNote } : {}),
          },
          select: { id: true, status: true, startedAt: true, endedAt: true },
        });
        await transaction.auditEvent.create({
          data: auditData(
            staff,
            shift.id,
            "SHIFT_STARTED",
            "StaffShift",
            shift.id,
          ),
        });
        return summarizeShift(transaction, shift);
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "P2002") {
        throw new ActiveShiftExistsError();
      }
      throw error;
    }
  },

  async endShift({ staff, closingNote }) {
    assertStaffPermission(staff.role, "SHIFT_SELF");
    return prisma.$transaction(async (transaction) => {
      const active = await requireActiveShift(transaction, staff);
      const endedAt = new Date();
      await transaction.tableAssignment.updateMany({
        where: { shiftId: active.id, endedAt: null },
        data: { activeTableKey: null, endedAt },
      });
      const shift = await transaction.staffShift.update({
        where: { id: active.id },
        data: {
          status: "CLOSED",
          activeShiftKey: null,
          endedAt,
          ...(closingNote ? { closingNote } : {}),
        },
        select: { id: true, status: true, startedAt: true, endedAt: true },
      });
      await transaction.auditEvent.create({
        data: auditData(
          staff,
          active.id,
          "SHIFT_ENDED",
          "StaffShift",
          active.id,
        ),
      });
      return summarizeShift(transaction, shift);
    });
  },

  async recordPayment(input) {
    assertStaffPermission(input.staff.role, "PAYMENT_RECORD");
    return prisma.$transaction(async (transaction) => {
      const existing = await transaction.paymentRecord.findUnique({
        where: {
          tableSessionId_recordedByUserId_idempotencyKey: {
            tableSessionId: input.tableSessionId,
            recordedByUserId: input.staff.userId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) return existing;

      const shift = await requireActiveShift(transaction, input.staff);
      await transaction.$queryRaw`SELECT "id" FROM "TableSession" WHERE "id" = ${input.tableSessionId} AND "tenantId" = ${input.staff.tenantId} AND "venueId" = ${input.staff.venueId} FOR UPDATE`;
      const session = await transaction.tableSession.findFirst({
        where: {
          id: input.tableSessionId,
          tenantId: input.staff.tenantId,
          venueId: input.staff.venueId,
        },
        include: {
          venue: { select: { currency: true } },
          orders: {
            where: { status: { not: "CANCELLED" } },
            select: { totalMinor: true },
          },
          paymentRecords: {
            where: { status: "RECORDED" },
            select: { amountMinor: true },
          },
        },
      });
      if (!session) throw new WorkResourceNotFoundError("table session");
      const due = session.orders.reduce(
        (sum, order) => sum + order.totalMinor,
        0,
      );
      const paid = session.paymentRecords.reduce(
        (sum, payment) => sum + payment.amountMinor,
        0,
      );
      if (input.amountMinor <= 0 || input.amountMinor > due - paid) {
        throw new PaymentBalanceError();
      }
      const payment = await transaction.paymentRecord.create({
        data: {
          tenantId: input.staff.tenantId,
          venueId: input.staff.venueId,
          tableSessionId: session.id,
          amountMinor: input.amountMinor,
          currency: session.venue.currency,
          method: input.method,
          idempotencyKey: input.idempotencyKey,
          recordedByUserId: input.staff.userId,
          recordedByMembershipId: input.staff.membershipId,
          recordedByShiftId: shift.id,
          ...(input.externalReference
            ? { externalReference: input.externalReference }
            : {}),
        },
      });
      await transaction.auditEvent.create({
        data: auditData(
          input.staff,
          shift.id,
          "PAYMENT_RECORDED",
          "PaymentRecord",
          payment.id,
          { amountMinor: payment.amountMinor, method: payment.method },
        ),
      });
      return payment;
    });
  },

  async voidPayment({ staff, paymentId, reason }) {
    assertStaffPermission(staff.role, "PAYMENT_VOID");
    return prisma.$transaction(async (transaction) => {
      const shift = await requireActiveShift(transaction, staff);
      const payment = await transaction.paymentRecord.findFirst({
        where: {
          id: paymentId,
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          status: "RECORDED",
        },
      });
      if (!payment) throw new WorkResourceNotFoundError("payment");
      if (payment.orderId)
        throw new CounterSaleError(
          "FINALIZED_PAYMENT",
          "A finalized receipt requires a new correction document; direct void is not supported in P2",
        );
      const voidedAt = new Date();
      await transaction.paymentRecord.update({
        where: { id: payment.id },
        data: {
          status: "VOIDED",
          voidedAt,
          voidReason: reason,
          voidedByUserId: staff.userId,
          voidedByMembershipId: staff.membershipId,
          voidedByShiftId: shift.id,
        },
      });
      await transaction.auditEvent.create({
        data: auditData(
          staff,
          shift.id,
          "PAYMENT_VOIDED",
          "PaymentRecord",
          payment.id,
          {
            reason,
          },
        ),
      });
      return { id: payment.id, status: "VOIDED", voidedAt };
    });
  },
};
