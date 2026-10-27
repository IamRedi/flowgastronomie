import { businessDayUtcRange } from "./reporting";

export type ReconciliationOrder = {
  id: string;
  kind: "ORDER" | "ONLINE_ORDER";
  createdAt: string;
  status: string;
  totalMinor: number;
  /** A real session-only payment exists; its allocation to this order is unknown. */
  unallocatedSessionPayment?: boolean;
};
export type ReconciliationPayment = {
  id: string;
  orderId: string | null;
  onlineOrderId: string | null;
  tableSessionId: string | null;
  amountMinor: number;
  method: "CASH" | "CARD_AT_TABLE" | "CARD_AT_COUNTER" | "OTHER";
  status: "RECORDED" | "VOIDED";
  recordedAt: string;
};

export type DailyReconciliation = {
  ordersCreated: {
    count: number;
    orderValueMinor: number;
    /** Currently recorded payments directly linked to these orders, any date. */
    paidMinor: number;
    /** Known outstanding direct-order amounts, excluding unallocated sessions. */
    pendingMinor: number;
    /** Order value whose payment is recorded only at session level. */
    unallocatedMinor: number;
    overpaidMinor: number;
    excludedCount: number;
  };
  paymentsRecorded: {
    totalMinor: number;
    cashMinor: number;
    cardMinor: number;
    otherMinor: number;
    todayOrdersMinor: number;
    otherPaymentsMinor: number;
    earlierOrdersMinor: number;
    tableSessionOnlyMinor: number;
    excludedOrdersMinor: number;
    /** Missing/ambiguous relationships or an order dated after this day. */
    unlinkedMinor: number;
  };
};

export const reportOrderEligible = (status: string) =>
  status !== "CANCELLED" && status !== "REJECTED";

export function summarizeOrderPayment(
  totalMinor: number,
  direct: Pick<
    ReconciliationPayment,
    "amountMinor" | "method" | "status"
  > | null,
  session: {
    orderTotals: readonly number[];
    payments: readonly Pick<
      ReconciliationPayment,
      "amountMinor" | "method" | "orderId" | "onlineOrderId"
    >[];
  } | null = null,
) {
  const payment = direct?.status === "RECORDED" ? direct : null;
  const unallocated =
    session?.payments.filter((p) => !p.orderId && !p.onlineOrderId) ?? [];
  const sessionPaid =
    !!session &&
    session.orderTotals.length > 0 &&
    session.payments.reduce((sum, p) => sum + p.amountMinor, 0) >=
      session.orderTotals.reduce((sum, value) => sum + value, 0);
  return {
    paid: (!!payment && payment.amountMinor >= totalMinor) || sessionPaid,
    paidMinor: payment?.amountMinor ?? 0,
    paymentMethods: payment
      ? [payment.method]
      : [...new Set(unallocated.map((p) => p.method))],
    sessionPaymentMinor: unallocated.reduce((sum, p) => sum + p.amountMinor, 0),
  };
}

/** A read projection only. Never fabricate an allocation for a session payment.
 * Orders and payments must already be scoped to the same tenant and venue.
 * Include the day's orders, targets of the day's payments, and all currently
 * recorded direct payments on the day's orders. IDs are deduplicated because
 * one record can belong to both the creation-day and payment-day projections.
 */
export function reconcileDailyPayments(input: {
  date: string;
  timezone: string;
  orders: readonly ReconciliationOrder[];
  payments: readonly ReconciliationPayment[];
}): DailyReconciliation {
  const range = businessDayUtcRange(input.date, input.timezone);
  const start = range.startsAt.getTime();
  const end = range.endsAt.getTime();
  const inDay = (instant: string) => {
    const timestamp = Date.parse(instant);
    return timestamp >= start && timestamp < end;
  };
  const key = (kind: ReconciliationOrder["kind"], id: string) =>
    `${kind}:${id}`;
  const orders = new Map<string, ReconciliationOrder>();
  for (const order of input.orders) {
    const id = key(order.kind, order.id);
    orders.set(id, { ...orders.get(id), ...order });
  }
  const payments = [
    ...new Map(input.payments.map((p) => [p.id, p])).values(),
  ].filter((p) => p.status === "RECORDED");
  const targetKey = (p: ReconciliationPayment) =>
    p.orderId && !p.onlineOrderId
      ? key("ORDER", p.orderId)
      : p.onlineOrderId && !p.orderId
        ? key("ONLINE_ORDER", p.onlineOrderId)
        : null;
  const paidByOrder = new Map<string, number>();
  for (const payment of payments) {
    const target = targetKey(payment);
    if (target && orders.has(target))
      paidByOrder.set(
        target,
        (paidByOrder.get(target) ?? 0) + payment.amountMinor,
      );
  }
  const created = [...orders.values()].filter((order) =>
    inDay(order.createdAt),
  );
  const eligible = created.filter((order) => reportOrderEligible(order.status));
  const result: DailyReconciliation = {
    ordersCreated: {
      count: eligible.length,
      orderValueMinor: 0,
      paidMinor: 0,
      pendingMinor: 0,
      unallocatedMinor: 0,
      overpaidMinor: 0,
      excludedCount: created.length - eligible.length,
    },
    paymentsRecorded: {
      totalMinor: 0,
      cashMinor: 0,
      cardMinor: 0,
      otherMinor: 0,
      todayOrdersMinor: 0,
      otherPaymentsMinor: 0,
      earlierOrdersMinor: 0,
      tableSessionOnlyMinor: 0,
      excludedOrdersMinor: 0,
      unlinkedMinor: 0,
    },
  };
  for (const order of eligible) {
    const paid = paidByOrder.get(key(order.kind, order.id)) ?? 0;
    result.ordersCreated.orderValueMinor += order.totalMinor;
    result.ordersCreated.paidMinor += paid;
    const outstanding = Math.max(0, order.totalMinor - paid);
    if (order.unallocatedSessionPayment)
      result.ordersCreated.unallocatedMinor += outstanding;
    else result.ordersCreated.pendingMinor += outstanding;
    result.ordersCreated.overpaidMinor += Math.max(0, paid - order.totalMinor);
  }
  const recorded = result.paymentsRecorded;
  for (const payment of payments.filter((p) => inDay(p.recordedAt))) {
    recorded.totalMinor += payment.amountMinor;
    if (payment.method === "CASH") recorded.cashMinor += payment.amountMinor;
    else if (payment.method === "OTHER")
      recorded.otherMinor += payment.amountMinor;
    else recorded.cardMinor += payment.amountMinor;
    const target = targetKey(payment);
    const order = target ? orders.get(target) : undefined;
    if (order && !reportOrderEligible(order.status))
      recorded.excludedOrdersMinor += payment.amountMinor;
    else if (order && inDay(order.createdAt))
      recorded.todayOrdersMinor += payment.amountMinor;
    else if (order && Date.parse(order.createdAt) < start)
      recorded.earlierOrdersMinor += payment.amountMinor;
    else if (
      !payment.orderId &&
      !payment.onlineOrderId &&
      payment.tableSessionId
    )
      recorded.tableSessionOnlyMinor += payment.amountMinor;
    else recorded.unlinkedMinor += payment.amountMinor;
  }
  recorded.otherPaymentsMinor = recorded.totalMinor - recorded.todayOrdersMinor;
  return result;
}
