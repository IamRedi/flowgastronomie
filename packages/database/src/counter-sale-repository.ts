import { Prisma, type Receipt } from "@prisma/client";
import {
  assertStaffPermission,
  assertOnlinePickupPayable,
  cashChange,
  cashClosing,
  CounterSaleError,
  minorAmount,
  snapshotTax,
  taxTotals,
  type FinalReceipt,
  type TaxLineSnapshot,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import {
  requireActiveShift,
  type StaffActor,
} from "./staff-work-repository.js";

const scope = (staff: StaffActor) => ({
  tenantId: staff.tenantId,
  venueId: staff.venueId,
});
function audit(
  staff: StaffActor,
  shiftId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Prisma.InputJsonValue,
) {
  return {
    ...scope(staff),
    actorUserId: staff.userId,
    actorMembershipId: staff.membershipId,
    actorShiftId: shiftId,
    action,
    entityType,
    entityId,
    metadata,
  };
}
async function lockVenue(tx: Prisma.TransactionClient, staff: StaffActor) {
  const rows = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT "id" FROM "Venue" WHERE "id" = ${staff.venueId} AND "tenantId" = ${staff.tenantId} FOR UPDATE`;
  if (!rows.length) throw new CounterSaleError("NOT_FOUND", "Venue not found");
}
function mapReceipt(row: Receipt): FinalReceipt {
  return {
    ...(row.snapshot as unknown as FinalReceipt),
    id: row.id,
    number: row.number,
    orderId: row.orderId,
    onlineOrderId: row.onlineOrderId,
    paymentId: row.paymentId,
    issuedAt: row.issuedAt.toISOString(),
    finalizedAt: row.finalizedAt.toISOString(),
    status: row.status,
  };
}

export const counterSaleRepository = {
  async register(staff: StaffActor) {
    assertStaffPermission(staff.role, "PAYMENT_RECORD");
    const session = await prisma.cashSession.findFirst({
      where: { ...scope(staff), status: "OPEN" },
    });
    const history = await prisma.cashSession.findMany({
      where: { ...scope(staff), status: "CLOSED" },
      orderBy: { closedAt: "desc" },
      take: 10,
    });
    if (!session) return { session: null, history };
    const cash = await prisma.paymentRecord.aggregate({
      where: {
        ...scope(staff),
        cashSessionId: session.id,
        method: "CASH",
        status: "RECORDED",
      },
      _sum: { amountMinor: true },
    });
    return {
      session: {
        ...session,
        expectedCashMinor: minorAmount(
          session.openingCashMinor + (cash._sum.amountMinor ?? 0),
        ),
      },
      history,
    };
  },

  async open(
    staff: StaffActor,
    openingCashMinor: number,
    openingNote?: string,
  ) {
    assertStaffPermission(staff.role, "REGISTER_MANAGE");
    minorAmount(openingCashMinor);
    return prisma.$transaction(async (tx) => {
      await lockVenue(tx, staff);
      const shift = await requireActiveShift(tx, staff);
      if (
        await tx.cashSession.findFirst({
          where: { ...scope(staff), status: "OPEN" },
        })
      )
        throw new CounterSaleError(
          "REGISTER_ALREADY_OPEN",
          "This venue already has an open register",
        );
      const session = await tx.cashSession.create({
        data: {
          ...scope(staff),
          openedByMembershipId: staff.membershipId,
          shiftId: shift.id,
          openingCashMinor,
          activeVenueKey: staff.venueId,
          ...(openingNote ? { openingNote } : {}),
        },
      });
      await tx.auditEvent.create({
        data: audit(
          staff,
          shift.id,
          "REGISTER_OPENED",
          "CashSession",
          session.id,
          { openingCashMinor },
        ),
      });
      return session;
    });
  },

  async close(
    staff: StaffActor,
    id: string,
    countedCashMinor: number,
    closingNote?: string,
  ) {
    assertStaffPermission(staff.role, "REGISTER_MANAGE");
    minorAmount(countedCashMinor);
    return prisma.$transaction(async (tx) => {
      await lockVenue(tx, staff);
      const shift = await requireActiveShift(tx, staff);
      const session = await tx.cashSession.findFirst({
        where: { id, ...scope(staff), status: "OPEN" },
      });
      if (!session)
        throw new CounterSaleError(
          "NOT_FOUND",
          "Open register not found in this venue",
        );
      const cash = await tx.paymentRecord.aggregate({
        where: {
          ...scope(staff),
          cashSessionId: id,
          method: "CASH",
          status: "RECORDED",
        },
        _sum: { amountMinor: true },
      });
      const balance = cashClosing(
        session.openingCashMinor,
        cash._sum.amountMinor ?? 0,
        countedCashMinor,
      );
      const closed = await tx.cashSession.update({
        where: { id },
        data: {
          ...balance,
          status: "CLOSED",
          closedAt: new Date(),
          activeVenueKey: null,
          closedByMembershipId: staff.membershipId,
          closedByShiftId: shift.id,
          ...(closingNote ? { closingNote } : {}),
        },
      });
      await tx.auditEvent.create({
        data: audit(
          staff,
          shift.id,
          "REGISTER_CLOSED",
          "CashSession",
          id,
          balance,
        ),
      });
      return closed;
    });
  },

  async taxConfiguration(staff: StaffActor) {
    assertStaffPermission(staff.role, "MENU_MANAGE");
    return prisma.taxCategory.findMany({
      where: scope(staff),
      orderBy: { code: "asc" },
      include: { products: { select: { id: true } } },
    });
  },

  async configureTax(
    staff: StaffActor,
    input: {
      code: string;
      rateBasisPoints: number;
      dineInRateBasisPoints?: number | null | undefined;
      takeawayRateBasisPoints?: number | null | undefined;
      productIds: string[];
    },
  ) {
    assertStaffPermission(staff.role, "MENU_MANAGE");
    snapshotTax(input.code, input.rateBasisPoints, 0, 1);
    for (const rate of [
      input.dineInRateBasisPoints,
      input.takeawayRateBasisPoints,
    ])
      if (rate != null) snapshotTax(input.code, rate, 0, 1);
    return prisma.$transaction(async (tx) => {
      await lockVenue(tx, staff);
      const ids = [...new Set(input.productIds)];
      if (
        (await tx.product.count({
          where: { ...scope(staff), id: { in: ids } },
        })) !== ids.length
      )
        throw new CounterSaleError(
          "NOT_FOUND",
          "Products not found in this venue",
        );
      const category = await tx.taxCategory.upsert({
        where: { venueId_code: { venueId: staff.venueId, code: input.code } },
        create: {
          ...scope(staff),
          code: input.code,
          rateBasisPoints: input.rateBasisPoints,
          dineInRateBasisPoints: input.dineInRateBasisPoints ?? null,
          takeawayRateBasisPoints: input.takeawayRateBasisPoints ?? null,
        },
        update: {
          rateBasisPoints: input.rateBasisPoints,
          dineInRateBasisPoints: input.dineInRateBasisPoints ?? null,
          takeawayRateBasisPoints: input.takeawayRateBasisPoints ?? null,
        },
      });
      await tx.product.updateMany({
        where: { ...scope(staff), id: { in: ids } },
        data: { taxCategoryId: category.id },
      });
      await tx.auditEvent.create({
        data: {
          ...audit(
            staff,
            "",
            "TAX_CONFIGURATION_CHANGED",
            "TaxCategory",
            category.id,
            { ...input },
          ),
          actorShiftId: null,
        },
      });
      return category;
    });
  },

  async pay(
    staff: StaffActor,
    input: {
      orderId?: string;
      onlineOrderId?: string;
      method: "CASH" | "CARD_AT_COUNTER";
      receivedMinor?: number;
      terminalConfirmed?: boolean;
      idempotencyKey: string;
    },
  ): Promise<FinalReceipt> {
    assertStaffPermission(staff.role, "PAYMENT_RECORD");
    if ((input.orderId == null) === (input.onlineOrderId == null))
      throw new CounterSaleError("NOT_FOUND", "Exactly one order is required");
    return prisma.$transaction(
      async (tx) => {
        await lockVenue(tx, staff);
        const key = `${staff.tenantId}:${staff.venueId}:${staff.membershipId}:${input.idempotencyKey}`;
        const existing = await tx.paymentRecord.findFirst({
          where: { ...scope(staff), counterPaymentKey: key },
          include: { receipt: true },
        });
        if (existing) {
          if (
            existing.orderId !== (input.orderId ?? null) ||
            existing.onlineOrderId !== (input.onlineOrderId ?? null) ||
            existing.method !== input.method ||
            existing.receivedMinor !== (input.receivedMinor ?? null) ||
            !existing.receipt
          )
            throw new CounterSaleError(
              "IDEMPOTENCY_CONFLICT",
              "The payment key was already used with different data",
            );
          return mapReceipt(existing.receipt);
        }
        const shift = await requireActiveShift(tx, staff);
        if (input.orderId)
          await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} AND "tenantId" = ${staff.tenantId} AND "venueId" = ${staff.venueId} FOR UPDATE`;
        else
          await tx.$queryRaw`SELECT "id" FROM "OnlineOrder" WHERE "id" = ${input.onlineOrderId} AND "tenantId" = ${staff.tenantId} AND "venueId" = ${staff.venueId} FOR UPDATE`;
        const staffOrder = input.orderId
          ? await tx.order.findFirst({
              where: {
                id: input.orderId,
                ...scope(staff),
                source: "STAFF_TABLET",
              },
              include: {
                items: { include: { modifiers: true } },
                counterPayment: true,
              },
            })
          : null;
        const onlineOrder = input.onlineOrderId
          ? await tx.onlineOrder.findFirst({
              where: {
                id: input.onlineOrderId,
                ...scope(staff),
                fulfillmentType: "PICKUP",
              },
              include: {
                items: { include: { modifiers: true } },
                counterPayment: true,
              },
            })
          : null;
        const order = staffOrder ?? onlineOrder;
        if (!order)
          throw new CounterSaleError(
            "NOT_FOUND",
            "POS order not found in this venue",
          );
        if (order.counterPayment)
          throw new CounterSaleError(
            "ALREADY_PAID",
            "This order already has a finalized payment",
          );
        if (onlineOrder)
          assertOnlinePickupPayable(
            onlineOrder.fulfillmentType,
            onlineOrder.status,
          );
        if (order.status === "CANCELLED")
          throw new CounterSaleError(
            "ORDER_CANCELLED",
            "A cancelled order cannot be paid",
          );
        if (staffOrder?.tableSessionId) {
          await tx.$queryRaw`SELECT "id" FROM "TableSession" WHERE "id" = ${staffOrder.tableSessionId} FOR UPDATE`;
          const recorded = await tx.paymentRecord.count({
            where: {
              ...scope(staff),
              tableSessionId: staffOrder.tableSessionId,
              status: "RECORDED",
            },
          });
          if (recorded)
            throw new CounterSaleError(
              "TABLE_PAYMENT_CONFLICT",
              "This table already has payment records; use its existing reconciliation flow",
            );
        }
        const business = await tx.organizationBillingProfile.findUnique({
          where: { tenantId: staff.tenantId },
        });
        if (
          !business ||
          [
            business.legalName,
            business.addressLine1,
            business.postalCode,
            business.city,
            business.countryCode,
          ].some((value) => !value.trim())
        )
          throw new CounterSaleError(
            "RECEIPT_BUSINESS_NOT_READY",
            "Complete the organization legal name and address before taking POS payment",
          );
        const cashier = await tx.membership.findFirst({
          where: {
            id: staff.membershipId,
            ...scope(staff),
            userId: staff.userId,
            active: true,
          },
          include: { user: true },
        });
        const venue = await tx.venue.findFirstOrThrow({
          where: { id: staff.venueId, tenantId: staff.tenantId },
        });
        if (!cashier)
          throw new CounterSaleError("NOT_FOUND", "Cashier not found");
        const lines = order.items.map((item) => {
          if (!item.taxSnapshot)
            throw new CounterSaleError(
              "RECEIPT_TAX_NOT_READY",
              "Order has no configured immutable tax snapshot; configure products before creating a new POS order",
            );
          const tax = item.taxSnapshot as unknown as TaxLineSnapshot;
          if (
            tax.quantity !== item.quantity ||
            tax.grossUnitMinor !== item.unitPriceMinor
          )
            throw new CounterSaleError(
              "INVALID_TAX",
              "Order tax snapshot does not match its item",
            );
          return {
            ...tax,
            productId: item.productId,
            productName: item.productName,
            variantName: item.variantName,
            modifiers: item.modifiers.map((m) => ({
              optionName: m.optionName,
              priceDeltaMinor: m.priceDeltaMinor,
            })),
          };
        });
        const totals = taxTotals(lines);
        if (!lines.length || totals.grossMinor !== order.totalMinor)
          throw new CounterSaleError(
            "INVALID_TAX",
            "Order and tax totals do not reconcile",
          );
        let cashSessionId: string | null = null;
        let changeMinor: number | null = null;
        if (input.method === "CASH") {
          changeMinor = cashChange(order.totalMinor, input.receivedMinor ?? -1);
          const session = await tx.cashSession.findFirst({
            where: { ...scope(staff), status: "OPEN" },
          });
          if (!session)
            throw new CounterSaleError(
              "REGISTER_REQUIRED",
              "Open the register before accepting cash",
            );
          cashSessionId = session.id;
          const recordedCash = await tx.paymentRecord.aggregate({
            where: {
              ...scope(staff),
              cashSessionId: session.id,
              method: "CASH",
              status: "RECORDED",
            },
            _sum: { amountMinor: true },
          });
          // Refuse a payment that would make the register impossible to close
          // within the persisted integer-money range.
          minorAmount(
            session.openingCashMinor +
              (recordedCash._sum.amountMinor ?? 0) +
              order.totalMinor,
          );
        } else if (
          !input.terminalConfirmed ||
          input.receivedMinor !== undefined
        )
          throw new CounterSaleError(
            "TERMINAL_CONFIRMATION_REQUIRED",
            "Confirm only after the independent card terminal accepts payment",
          );
        const payment = await tx.paymentRecord.create({
          data: {
            ...scope(staff),
            orderId: staffOrder?.id ?? null,
            onlineOrderId: onlineOrder?.id ?? null,
            tableSessionId: staffOrder?.tableSessionId ?? null,
            cashSessionId,
            amountMinor: order.totalMinor,
            currency: order.currency,
            method: input.method,
            receivedMinor: input.receivedMinor ?? null,
            changeMinor,
            counterPaymentKey: key,
            idempotencyKey: input.idempotencyKey,
            recordedByUserId: staff.userId,
            recordedByMembershipId: staff.membershipId,
            recordedByShiftId: shift.id,
          },
        });
        const sequence = await tx.receiptSequence.upsert({
          where: { venueId: staff.venueId },
          create: { ...scope(staff), lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
        });
        const number = `R-${String(sequence.lastNumber).padStart(6, "0")}`;
        const data = {
          currency: order.currency,
          ...totals,
          method: input.method,
          receivedMinor: input.receivedMinor ?? null,
          changeMinor,
          business: {
            legalName: business.legalName,
            addressLine1: business.addressLine1,
            postalCode: business.postalCode,
            city: business.city,
            countryCode: business.countryCode,
            vatId: business.vatId,
            venueId: venue.id,
            venueName: venue.name,
          },
          cashier: {
            membershipId: staff.membershipId,
            displayName: cashier.user.displayName,
          },
          items: lines,
        };
        const receipt = await tx.receipt.create({
          data: {
            ...scope(staff),
            orderId: staffOrder?.id ?? null,
            onlineOrderId: onlineOrder?.id ?? null,
            paymentId: payment.id,
            sequence: sequence.lastNumber,
            number,
            snapshot: data,
          },
        });
        await tx.auditEvent.createMany({
          data: [
            audit(
              staff,
              shift.id,
              "COUNTER_PAYMENT_RECORDED",
              "PaymentRecord",
              payment.id,
              {
                orderId: staffOrder?.id ?? null,
                onlineOrderId: onlineOrder?.id ?? null,
                method: input.method,
                amountMinor: order.totalMinor,
                cashSessionId,
              },
            ),
            audit(staff, shift.id, "RECEIPT_FINALIZED", "Receipt", receipt.id, {
              number,
              paymentId: payment.id,
              grossMinor: totals.grossMinor,
            }),
          ],
        });
        return mapReceipt(receipt);
      },
      { timeout: 10_000 },
    );
  },

  async payOnline(
    staff: StaffActor,
    input: {
      onlineOrderId: string;
      method: "CASH" | "CARD_AT_COUNTER";
      receivedMinor?: number;
      terminalConfirmed?: boolean;
      idempotencyKey: string;
    },
  ): Promise<FinalReceipt> {
    return counterSaleRepository.pay(staff, input);
  },

  async receipt(staff: StaffActor, id: string) {
    assertStaffPermission(staff.role, "PAYMENT_RECORD");
    const row = await prisma.receipt.findFirst({
      where: { id, ...scope(staff) },
    });
    if (!row)
      throw new CounterSaleError(
        "NOT_FOUND",
        "Receipt not found in this venue",
      );
    return mapReceipt(row);
  },
};

export type CounterSaleRepository = typeof counterSaleRepository;
