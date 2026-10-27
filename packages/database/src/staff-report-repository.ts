import {
  assertStaffPermission,
  businessDateForInstant,
  businessDayUtcRange,
  calculateDailyRecipeCost,
  calculateRecipeCost,
  convertIngredientQuantity,
  hasStaffPermission,
  reconcileDailyPayments,
  reportOrderEligible,
  type DailyOperationsReport,
  type IngredientUnit,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import { subscriptionRepository } from "./subscription-repository.js";
import type { StaffActor } from "./staff-work-repository.js";

const paymentSelect = {
  id: true,
  orderId: true,
  onlineOrderId: true,
  tableSessionId: true,
  amountMinor: true,
  method: true,
  status: true,
  recordedAt: true,
  tenantId: true,
  venueId: true,
} as const;
const orderSelect = {
  id: true,
  status: true,
  totalMinor: true,
  createdAt: true,
  tenantId: true,
  venueId: true,
} as const;

export type StaffReportRepository = {
  daily(input: {
    staff: StaffActor;
    date?: string | undefined;
  }): Promise<DailyOperationsReport>;
};

function overlapMinutes(
  startedAt: Date,
  endedAt: Date | null,
  range: { startsAt: Date; endsAt: Date },
  now: Date,
) {
  const start = Math.max(startedAt.getTime(), range.startsAt.getTime());
  const end = Math.min(
    (endedAt ?? now).getTime(),
    range.endsAt.getTime(),
    now.getTime(),
  );
  return Math.max(0, Math.round((end - start) / 60_000));
}

export const staffReportRepository: StaffReportRepository = {
  async daily({ staff, date }) {
    await subscriptionRepository.assertFeature(staff.tenantId, "REPORTING");
    const canViewVenue = hasStaffPermission(staff.role, "SHIFT_REPORT");
    if (!canViewVenue) assertStaffPermission(staff.role, "SHIFT_SELF");

    const venue = await prisma.venue.findFirstOrThrow({
      where: { id: staff.venueId, tenantId: staff.tenantId },
      select: { timezone: true, currency: true },
    });
    const reportDate =
      date ?? businessDateForInstant(new Date(), venue.timezone);
    const range = businessDayUtcRange(reportDate, venue.timezone);
    const scope = canViewVenue ? "VENUE" : "SELF";
    const membershipScope = canViewVenue
      ? {}
      : { actorMembershipId: staff.membershipId };
    const shiftScope = canViewVenue ? {} : { membershipId: staff.membershipId };
    const paymentScope = canViewVenue
      ? {}
      : { recordedByMembershipId: staff.membershipId };
    const orderScope = canViewVenue
      ? {}
      : {
          OR: [
            { createdByMembershipId: staff.membershipId },
            { serviceOwnerMembershipId: staff.membershipId },
          ],
        };
    const signalScope = canViewVenue
      ? {}
      : { acknowledgedByUserId: staff.userId };

    const [
      members,
      orders,
      recordedPayments,
      voidedPayments,
      signals,
      shifts,
      events,
      onlineOrders,
      reservations,
      tableItems,
      onlineItems,
    ] = await prisma.$transaction(
      [
        prisma.membership.findMany({
          where: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            ...(canViewVenue ? {} : { id: staff.membershipId }),
          },
          include: { user: { select: { displayName: true } } },
        }),
        prisma.order.findMany({
          where: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            createdAt: { gte: range.startsAt, lt: range.endsAt },
            ...orderScope,
          },
          select: {
            ...orderSelect,
            counterPayment: { select: paymentSelect },
            tableSession: {
              select: {
                paymentRecords: {
                  where: {
                    tenantId: staff.tenantId,
                    venueId: staff.venueId,
                    status: "RECORDED",
                    orderId: null,
                    onlineOrderId: null,
                  },
                  select: { id: true },
                },
              },
            },
          },
        }),
        prisma.paymentRecord.findMany({
          where: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            recordedAt: { gte: range.startsAt, lt: range.endsAt },
            status: "RECORDED",
            ...paymentScope,
          },
          select: {
            ...paymentSelect,
            recordedByMembershipId: true,
            order: { select: orderSelect },
            onlineOrder: { select: orderSelect },
          },
        }),
        prisma.paymentRecord.findMany({
          where: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            voidedAt: { gte: range.startsAt, lt: range.endsAt },
            status: "VOIDED",
            ...(canViewVenue
              ? {}
              : { voidedByMembershipId: staff.membershipId }),
          },
          select: { amountMinor: true },
        }),
        prisma.serviceSignal.findMany({
          where: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            createdAt: { gte: range.startsAt, lt: range.endsAt },
            type: { in: ["WAITER_CALL", "WATER_REQUEST", "BILL_REQUEST"] },
            ...signalScope,
          },
          select: { createdAt: true, acknowledgedAt: true },
        }),
        prisma.staffShift.findMany({
          where: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            startedAt: { lt: range.endsAt },
            OR: [{ endedAt: null }, { endedAt: { gte: range.startsAt } }],
            ...shiftScope,
          },
          select: {
            membershipId: true,
            status: true,
            startedAt: true,
            endedAt: true,
          },
        }),
        prisma.auditEvent.findMany({
          where: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            createdAt: { gte: range.startsAt, lt: range.endsAt },
            ...membershipScope,
          },
          select: { actorMembershipId: true, action: true },
        }),
        prisma.onlineOrder.findMany({
          where: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            createdAt: { gte: range.startsAt, lt: range.endsAt },
          },
          select: {
            ...orderSelect,
            fulfillmentType: true,
            counterPayment: { select: paymentSelect },
          },
        }),
        prisma.reservation.findMany({
          where: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            requestedFor: { gte: range.startsAt, lt: range.endsAt },
          },
          select: { status: true, partySize: true },
        }),
        prisma.orderItem.findMany({
          where: {
            order: {
              tenantId: staff.tenantId,
              venueId: staff.venueId,
              createdAt: { gte: range.startsAt, lt: range.endsAt },
              ...orderScope,
            },
          },
          select: {
            productId: true,
            productName: true,
            quantity: true,
            unitPriceMinor: true,
            order: { select: { status: true } },
          },
        }),
        prisma.onlineOrderItem.findMany({
          where: {
            onlineOrder: {
              tenantId: staff.tenantId,
              venueId: staff.venueId,
              createdAt: { gte: range.startsAt, lt: range.endsAt },
            },
          },
          select: {
            productId: true,
            productName: true,
            quantity: true,
            unitPriceMinor: true,
            onlineOrder: { select: { status: true } },
          },
        }),
      ],
      { isolationLevel: "RepeatableRead" },
    );

    const inScope = (row: { tenantId: string; venueId: string }) =>
      row.tenantId === staff.tenantId && row.venueId === staff.venueId;
    const reconciliation = canViewVenue
      ? reconcileDailyPayments({
          date: reportDate,
          timezone: venue.timezone,
          orders: [
            ...orders.map((order) => ({
              ...order,
              kind: "ORDER" as const,
              unallocatedSessionPayment:
                !!order.tableSession?.paymentRecords.length,
            })),
            ...onlineOrders.map((order) => ({
              ...order,
              kind: "ONLINE_ORDER" as const,
            })),
            ...recordedPayments.flatMap((payment) => [
              ...(payment.order && inScope(payment.order)
                ? [{ ...payment.order, kind: "ORDER" as const }]
                : []),
              ...(payment.onlineOrder && inScope(payment.onlineOrder)
                ? [{ ...payment.onlineOrder, kind: "ONLINE_ORDER" as const }]
                : []),
            ]),
          ].map((order) => ({
            ...order,
            createdAt: order.createdAt.toISOString(),
          })),
          payments: [
            ...recordedPayments,
            ...[...orders, ...onlineOrders].flatMap((order) =>
              order.counterPayment && inScope(order.counterPayment)
                ? [order.counterPayment]
                : [],
            ),
          ].map((payment) => ({
            ...payment,
            recordedAt: payment.recordedAt.toISOString(),
          })),
        })
      : null;

    const now = new Date();
    const staffRows = members
      .map((member) => {
        const memberShifts = shifts.filter(
          (shift) => shift.membershipId === member.id,
        );
        const memberEvents = events.filter(
          (event) => event.actorMembershipId === member.id,
        );
        const memberPayments = recordedPayments.filter(
          (payment) => payment.recordedByMembershipId === member.id,
        );
        const countAction = (action: string) =>
          memberEvents.filter((event) => event.action === action).length;
        return {
          membershipId: member.id,
          displayName: member.user.displayName,
          role: member.role,
          shiftCount: memberShifts.length,
          workedMinutes: memberShifts.reduce(
            (total, shift) =>
              total +
              overlapMinutes(shift.startedAt, shift.endedAt, range, now),
            0,
          ),
          onShift: memberShifts.some((shift) => shift.status === "OPEN"),
          actionCount: memberEvents.length,
          ticketsStarted: countAction("PRODUCTION_TICKET_STARTED"),
          ticketsReady: countAction("PRODUCTION_TICKET_READY"),
          partsServed: countAction("STATION_TICKET_SERVED"),
          requestsCompleted: countAction("TABLE_REQUEST_ACKNOWLEDGED"),
          paymentsRecorded: memberPayments.length,
          paymentTotalMinor: memberPayments.reduce(
            (total, payment) => total + payment.amountMinor,
            0,
          ),
          tablesClosed: countAction("TABLE_SESSION_CLOSED"),
        };
      })
      .filter(
        (row) =>
          scope === "SELF" ||
          row.shiftCount > 0 ||
          row.actionCount > 0 ||
          row.paymentsRecorded > 0,
      )
      .sort(
        (left, right) =>
          Number(right.onShift) - Number(left.onShift) ||
          right.actionCount - left.actionCount ||
          left.displayName.localeCompare(right.displayName),
      );

    const acknowledgedSignals = signals.filter(
      (signal) => signal.acknowledgedAt,
    );
    const acknowledgeSeconds = acknowledgedSignals.map((signal) =>
      Math.max(
        0,
        Math.round(
          (signal.acknowledgedAt!.getTime() - signal.createdAt.getTime()) /
            1_000,
        ),
      ),
    );
    const paymentTotal = (method: "CASH" | "CARD_AT_TABLE" | "OTHER") =>
      recordedPayments
        .filter((payment) => payment.method === method)
        .reduce((total, payment) => total + payment.amountMinor, 0);
    const orderValue = (items: Array<{ status: string; totalMinor: number }>) =>
      items
        .filter((item) => reportOrderEligible(item.status))
        .reduce((total, item) => total + item.totalMinor, 0);
    const onlineChannel = (
      fulfillmentType: "PICKUP" | "DELIVERY" | "CATERING",
    ) => {
      const items = onlineOrders.filter(
        (order) => order.fulfillmentType === fulfillmentType,
      );
      return { submitted: items.length, orderValueMinor: orderValue(items) };
    };
    const soldTableItems = tableItems.filter(
      (item) => item.order.status !== "CANCELLED",
    );
    const soldOnlineItems = onlineItems.filter(
      (item) =>
        item.onlineOrder.status !== "CANCELLED" &&
        item.onlineOrder.status !== "REJECTED",
    );
    const soldItems = [...soldTableItems, ...soldOnlineItems];
    const popularProducts = Array.from(
      soldItems
        .reduce(
          (products, item) => {
            const current = products.get(item.productId) ?? {
              productId: item.productId,
              productName: item.productName,
              quantity: 0,
              orderValueMinor: 0,
            };
            current.quantity += item.quantity;
            current.orderValueMinor += item.quantity * item.unitPriceMinor;
            products.set(item.productId, current);
            return products;
          },
          new Map<
            string,
            {
              productId: string;
              productName: string;
              quantity: number;
              orderValueMinor: number;
            }
          >(),
        )
        .values(),
    )
      .sort(
        (left, right) =>
          right.quantity - left.quantity ||
          right.orderValueMinor - left.orderValueMinor ||
          left.productName.localeCompare(right.productName),
      )
      .slice(0, 5);

    const productIds = [...new Set(soldItems.map((item) => item.productId))];
    const [recipes, prices] = productIds.length
      ? await Promise.all([
          prisma.recipe.findMany({
            where: {
              tenantId: staff.tenantId,
              venueId: staff.venueId,
              productId: { in: productIds },
            },
            include: {
              ingredients: { include: { ingredient: true } },
            },
          }),
          prisma.supplierItemPrice.findMany({
            where: {
              tenantId: staff.tenantId,
              venueId: staff.venueId,
              effectiveFrom: { lte: now },
              supplier: { active: true },
            },
            orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
          }),
        ])
      : ([[], []] as const);
    const priceByIngredient = new Map<string, (typeof prices)[number]>();
    for (const price of prices) {
      if (!priceByIngredient.has(price.ingredientId)) {
        priceByIngredient.set(price.ingredientId, price);
      }
    }
    const recipeEstimateByProduct = new Map(
      recipes.map((recipe) => [
        recipe.productId,
        calculateRecipeCost({
          sellingPriceMinor: 0,
          yieldBasisPoints: recipe.yieldBasisPoints,
          wastageBasisPoints: recipe.wastageBasisPoints,
          components: recipe.ingredients.map((item) => {
            const price = priceByIngredient.get(item.ingredientId);
            return {
              ingredientId: item.ingredientId,
              quantityBaseUnits: item.quantityBaseUnits,
              price: price
                ? {
                    packBaseQuantity: convertIngredientQuantity(
                      price.packQuantity,
                      price.unit as IngredientUnit,
                      item.ingredient.baseUnit as IngredientUnit,
                    ),
                    priceMinor: price.priceMinor,
                  }
                : null,
            };
          }),
        }),
      ]),
    );
    const costing = calculateDailyRecipeCost(
      soldItems.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        sellingPriceMinor: item.unitPriceMinor,
        estimate: recipeEstimateByProduct.get(item.productId) ?? null,
      })),
    );

    return {
      date: reportDate,
      timezone: venue.timezone,
      currency: venue.currency,
      scope,
      range: {
        startsAt: range.startsAt.toISOString(),
        endsAt: range.endsAt.toISOString(),
      },
      reconciliation,
      orders: {
        submitted: orders.length,
        served: orders.filter((order) => order.status === "SERVED").length,
        cancelled: orders.filter((order) => order.status === "CANCELLED")
          .length,
        orderValueMinor: orders
          .filter((order) => order.status !== "CANCELLED")
          .reduce((total, order) => total + order.totalMinor, 0),
      },
      channels: {
        table: {
          submitted: orders.length,
          orderValueMinor: orderValue(orders),
        },
        pickup: onlineChannel("PICKUP"),
        delivery: onlineChannel("DELIVERY"),
        catering: onlineChannel("CATERING"),
      },
      reservations: {
        requested: reservations.filter(
          (reservation) => reservation.status === "REQUESTED",
        ).length,
        confirmed: reservations.filter(
          (reservation) => reservation.status === "CONFIRMED",
        ).length,
        seated: reservations.filter(
          (reservation) => reservation.status === "SEATED",
        ).length,
        completed: reservations.filter(
          (reservation) => reservation.status === "COMPLETED",
        ).length,
        cancelled: reservations.filter(
          (reservation) => reservation.status === "CANCELLED",
        ).length,
        noShows: reservations.filter(
          (reservation) => reservation.status === "NO_SHOW",
        ).length,
        partySize: reservations.reduce(
          (total, reservation) => total + reservation.partySize,
          0,
        ),
      },
      popularProducts,
      costing,
      payments: {
        recordedMinor: recordedPayments.reduce(
          (total, payment) => total + payment.amountMinor,
          0,
        ),
        voidedMinor: voidedPayments.reduce(
          (total, payment) => total + payment.amountMinor,
          0,
        ),
        cashMinor: paymentTotal("CASH"),
        cardMinor:
          paymentTotal("CARD_AT_TABLE") +
          recordedPayments
            .filter((payment) => payment.method === "CARD_AT_COUNTER")
            .reduce((sum, payment) => sum + payment.amountMinor, 0),
        otherMinor: paymentTotal("OTHER"),
      },
      service: {
        requests: signals.length,
        acknowledged: acknowledgedSignals.length,
        unresolved: signals.length - acknowledgedSignals.length,
        averageAcknowledgeSeconds: acknowledgeSeconds.length
          ? Math.round(
              acknowledgeSeconds.reduce((total, value) => total + value, 0) /
                acknowledgeSeconds.length,
            )
          : null,
      },
      shifts: {
        count: shifts.length,
        open: shifts.filter((shift) => shift.status === "OPEN").length,
        workedMinutes: staffRows.reduce(
          (total, row) => total + row.workedMinutes,
          0,
        ),
      },
      staff: staffRows,
    };
  },
};
