import {
  assertStaffPermission,
  businessDateForInstant,
  businessDayUtcRange,
  pilotOrderMatchesView,
  reportOrderEligible,
  type PilotOrderView,
  canCompletePickup,
  counterOrderVisible,
  hasStaffPermission,
  orderReference,
  productionStations,
  simpleProductionStatus,
  onlineProductionCanStart,
  summarizeOrderPayment,
  StaffPermissionDeniedError,
  type CounterQueueOrder,
  type PilotTicket,
  type SimplePilotOrder,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import type { StaffActor } from "./staff-work-repository.js";
import type { StaffIdentity } from "./staff-auth-repository.js";
import {
  staffProductionRepository,
  ProductionTicketConflictError,
  ProductionTicketNotFoundError,
} from "./staff-production-repository.js";

const scope = (staff: StaffActor) => ({
  tenantId: staff.tenantId,
  venueId: staff.venueId,
});
export const pilotOperationsRepository = {
  async orders(
    staff: StaffActor,
    input: {
      view?: PilotOrderView | undefined;
      date?: string | undefined;
    } = {},
  ): Promise<SimplePilotOrder[]> {
    assertStaffPermission(staff.role, "ORDER_CREATE");
    const view = input.view ?? "ACTIVE";
    const venue = await prisma.venue.findFirstOrThrow({
      where: { id: staff.venueId, tenantId: staff.tenantId },
      select: { timezone: true },
    });
    const range = businessDayUtcRange(
      input.date ?? businessDateForInstant(new Date(), venue.timezone),
      venue.timezone,
    );
    const dateFilter =
      view === "ACTIVE"
        ? {}
        : { createdAt: { gte: range.startsAt, lt: range.endsAt } };
    const [counter, online] = await prisma.$transaction(
      [
        prisma.order.findMany({
          where: {
            ...scope(staff),
            ...dateFilter,
            ...(view === "ACTIVE"
              ? { status: { not: "CANCELLED" as const } }
              : {}),
          },
          include: {
            items: { include: { modifiers: true } },
            productionTickets: true,
            counterPayment: { include: { receipt: true } },
            tableSession: {
              include: {
                orders: {
                  where: { ...scope(staff), status: { not: "CANCELLED" } },
                  select: { totalMinor: true },
                },
                paymentRecords: {
                  where: { ...scope(staff), status: "RECORDED" },
                  select: {
                    amountMinor: true,
                    method: true,
                    orderId: true,
                    onlineOrderId: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.onlineOrder.findMany({
          where: {
            ...scope(staff),
            ...dateFilter,
            ...(view === "ACTIVE"
              ? {
                  status: {
                    notIn: ["REJECTED" as const, "CANCELLED" as const],
                  },
                }
              : {}),
          },
          include: {
            items: { include: { modifiers: true } },
            productionTickets: true,
            counterPayment: { include: { receipt: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
      ],
      { isolationLevel: "RepeatableRead" },
    );
    const canProduce =
      hasStaffPermission(staff.role, "ORDER_PREPARE") &&
      hasStaffPermission(staff.role, "ORDER_READY");
    const controls = (
      tickets: Array<{ assignedMembershipId: string | null }>,
    ) =>
      tickets.every(
        (ticket) =>
          !ticket.assignedMembershipId ||
          ticket.assignedMembershipId === staff.membershipId ||
          ["OWNER", "MANAGER"].includes(staff.role),
      );
    const recordedPayment = (
      payment: (typeof counter)[number]["counterPayment"],
    ) =>
      payment?.status === "RECORDED" &&
      payment.tenantId === staff.tenantId &&
      payment.venueId === staff.venueId
        ? payment
        : null;
    const result: SimplePilotOrder[] = counter.flatMap((order) => {
      const payment = recordedPayment(order.counterPayment);
      const session = order.tableSession;
      const paymentSummary = summarizeOrderPayment(
        order.totalMinor,
        payment,
        session
          ? {
              orderTotals: session.orders.map((o) => o.totalMinor),
              payments: session.paymentRecords,
            }
          : null,
      );
      const paid = paymentSummary.paid;
      const terminal =
        !reportOrderEligible(order.status) || order.status === "SERVED";
      const projected: SimplePilotOrder = {
        id: order.id,
        reference: orderReference(order.id),
        source:
          order.source === "STAFF_TABLET" && !order.tableId && !session
            ? "COUNTER"
            : "TABLE",
        lifecycleStatus: order.status,
        productionStatus: simpleProductionStatus(
          order.productionTickets.map((ticket) => ticket.status),
          order.status,
        ),
        paymentStatus: paid ? "PAID" : "PENDING_PAYMENT",
        totalMinor: order.totalMinor,
        currency: order.currency,
        createdAt: order.createdAt.toISOString(),
        receiptId: payment?.receipt?.id ?? null,
        paidMinor: paymentSummary.paidMinor,
        paymentMethods: paymentSummary.paymentMethods,
        sessionPaymentMinor: paymentSummary.sessionPaymentMinor,
        canPay:
          !paid &&
          !payment &&
          !paymentSummary.sessionPaymentMinor &&
          reportOrderEligible(order.status) &&
          order.source === "STAFF_TABLET" &&
          hasStaffPermission(staff.role, "PAYMENT_RECORD"),
        items: order.items.map((item) => ({
          quantity: item.quantity,
          productName: item.productName,
          variantName: item.variantName,
          notes: item.notes,
          modifiers: item.modifiers.map((m) => ({ optionName: m.optionName })),
        })),
        tickets: order.productionTickets.map((t) => ({
          id: t.id,
          station: t.station,
          status: t.status,
          version: t.version,
        })),
        canManage: false,
        canProduce:
          !terminal && canProduce && controls(order.productionTickets),
        canComplete:
          !terminal &&
          order.source === "STAFF_TABLET" &&
          hasStaffPermission(staff.role, "ORDER_SERVE") &&
          controls(order.productionTickets) &&
          canCompletePickup(order.productionTickets.map((t) => t.status)),
      };
      return pilotOrderMatchesView(
        projected,
        view,
        session?.status === "CLOSED",
      )
        ? [projected]
        : [];
    });
    result.push(
      ...online.flatMap((order) => {
        const payment = recordedPayment(order.counterPayment);
        const paymentSummary = summarizeOrderPayment(order.totalMinor, payment);
        const paid = paymentSummary.paid;
        const terminal =
          !reportOrderEligible(order.status) || order.status === "COMPLETED";
        const projected: SimplePilotOrder = {
          id: order.id,
          reference: order.referenceCode,
          source: "WEBSITE",
          lifecycleStatus: order.status,
          productionStatus: simpleProductionStatus(
            order.productionTickets.map((t) => t.status),
            order.status,
          ),
          paymentStatus: paid ? "PAID" : "PENDING_PAYMENT",
          totalMinor: order.totalMinor,
          currency: order.currency,
          createdAt: order.createdAt.toISOString(),
          receiptId: payment?.receipt?.id ?? null,
          paidMinor: payment?.amountMinor ?? 0,
          paymentMethods: payment ? [payment.method] : [],
          sessionPaymentMinor: 0,
          canPay:
            !paid &&
            !payment &&
            order.fulfillmentType === "PICKUP" &&
            order.status === "READY" &&
            hasStaffPermission(staff.role, "PAYMENT_RECORD"),
          items: order.items.map((item) => ({
            quantity: item.quantity,
            productName: item.productName,
            variantName: item.variantName,
            notes: item.notes,
            modifiers: item.modifiers.map((m) => ({
              optionName: m.optionName,
            })),
          })),
          tickets: order.productionTickets.map((t) => ({
            id: t.id,
            station: t.station,
            status: t.status,
            version: t.version,
          })),
          canManage: hasStaffPermission(staff.role, "ONLINE_ORDER_MANAGE"),
          canProduce:
            !terminal &&
            canProduce &&
            onlineProductionCanStart(order.productionNotBefore, new Date()),
          canComplete:
            order.fulfillmentType === "PICKUP" &&
            order.status === "READY" &&
            paid &&
            hasStaffPermission(staff.role, "ONLINE_ORDER_MANAGE"),
        };
        return pilotOrderMatchesView(projected, view) ? [projected] : [];
      }),
    );
    return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
  async production(
    staff: StaffActor,
    station: "KITCHEN" | "BAR",
  ): Promise<PilotTicket[]> {
    assertStaffPermission(staff.role, "RADAR_VIEW");
    const stations = productionStations(staff.role, station);
    if (!stations.length)
      throw new StaffPermissionDeniedError(staff.role, "ORDER_PREPARE");
    const tickets = await prisma.orderStationTicket.findMany({
      where: {
        ...scope(staff),
        station: { in: [...stations] },
        status: { not: "SERVED" },
        order: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          status: { not: "CANCELLED" },
        },
      },
      include: {
        order: {
          include: {
            table: true,
            tableSession: { include: { table: true } },
            items: { include: { modifiers: true } },
          },
        },
      },
      orderBy: { order: { createdAt: "asc" } },
    });
    return tickets.map((t) => {
      const controls =
        !t.assignedMembershipId ||
        t.assignedMembershipId === staff.membershipId ||
        ["OWNER", "MANAGER"].includes(staff.role);
      return {
        id: t.id,
        orderId: t.orderId,
        reference: orderReference(t.orderId),
        status: t.status,
        version: t.version,
        station: t.station,
        orderType:
          t.order.tableId || t.order.tableSession ? "DINE_IN" : "TAKEAWAY",
        tableLabel:
          t.order.table?.label ?? t.order.tableSession?.table.label ?? null,
        createdAt: t.order.createdAt.toISOString(),
        items: t.order.items
          .filter((i) => i.station === t.station)
          .map((i) => ({
            quantity: i.quantity,
            productName: i.productName,
            variantName: i.variantName,
            notes: i.notes,
            modifiers: i.modifiers.map((m) => ({ optionName: m.optionName })),
          })),
        canStart: controls && t.status === "NEW",
        canReady: controls && t.status === "PREPARING",
        canServe:
          controls &&
          t.status === "READY" &&
          hasStaffPermission(staff.role, "ORDER_SERVE"),
      };
    });
  },
  async counter(staff: StaffActor): Promise<CounterQueueOrder[]> {
    assertStaffPermission(staff.role, "ORDER_CREATE");
    const orders = await prisma.order.findMany({
      where: {
        ...scope(staff),
        source: "STAFF_TABLET",
        status: { not: "CANCELLED" },
        OR: [{ status: { not: "SERVED" } }, { counterPayment: null }],
      },
      include: {
        table: true,
        counterPayment: { include: { receipt: true } },
        productionTickets: true,
        items: { include: { modifiers: true } },
        tableSession: {
          include: {
            table: true,
            orders: {
              where: { status: { not: "CANCELLED" } },
              select: { totalMinor: true },
            },
            paymentRecords: {
              where: { status: "RECORDED" },
              select: { amountMinor: true },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return orders.flatMap((o) => {
      const tablePaid =
        o.tableSession != null &&
        o.tableSession.paymentRecords.reduce((s, p) => s + p.amountMinor, 0) >=
          o.tableSession.orders.reduce((s, r) => s + r.totalMinor, 0);
      const paid = !!o.counterPayment || tablePaid;
      if (
        !counterOrderVisible(
          o.status,
          paid,
          o.tableSession?.status === "CLOSED",
        )
      )
        return [];
      return [
        {
          id: o.id,
          reference: orderReference(o.id),
          orderType:
            o.tableId || o.tableSession
              ? ("DINE_IN" as const)
              : ("TAKEAWAY" as const),
          tableLabel: o.table?.label ?? o.tableSession?.table.label ?? null,
          totalMinor: o.totalMinor,
          currency: o.currency,
          productionStatus: o.status,
          paymentStatus: paid ? ("PAID" as const) : ("UNPAID" as const),
          receiptId: o.counterPayment?.receipt?.id ?? null,
          createdAt: o.createdAt.toISOString(),
          canComplete:
            hasStaffPermission(staff.role, "ORDER_SERVE") &&
            o.productionTickets.every(
              (t) =>
                !t.assignedMembershipId ||
                t.assignedMembershipId === staff.membershipId ||
                ["OWNER", "MANAGER"].includes(staff.role),
            ) &&
            canCompletePickup(o.productionTickets.map((t) => t.status)),
          items: o.items.map((i) => ({
            quantity: i.quantity,
            productName: i.productName,
            variantName: i.variantName,
            notes: i.notes,
            modifiers: i.modifiers.map((m) => ({ optionName: m.optionName })),
          })),
        },
      ];
    });
  },
  async complete(staff: StaffIdentity, id: string) {
    assertStaffPermission(staff.role, "ORDER_CREATE");
    assertStaffPermission(staff.role, "ORDER_SERVE");
    const order = await prisma.order.findFirst({
      where: {
        id,
        ...scope(staff),
        source: "STAFF_TABLET",
        status: { not: "CANCELLED" },
      },
      include: { productionTickets: true },
    });
    if (!order) throw new ProductionTicketNotFoundError();
    if (order.status === "SERVED") return { status: "SERVED" };
    if (!canCompletePickup(order.productionTickets.map((t) => t.status)))
      throw new ProductionTicketConflictError(
        "All stations must be ready before handoff",
      );
    for (const ticket of order.productionTickets.filter(
      (t) => t.status === "READY",
    ))
      await staffProductionRepository.transition({
        staff,
        ticketId: ticket.id,
        status: "SERVED",
        expectedVersion: ticket.version,
      });
    return { status: "SERVED" };
  },
};
