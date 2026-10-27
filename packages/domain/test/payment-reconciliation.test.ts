import { describe, expect, it } from "vitest";
import {
  reconcileDailyPayments,
  summarizeOrderPayment,
  type ReconciliationOrder,
  type ReconciliationPayment,
} from "../src/index";

const date = "2026-10-05";
const today = "2026-10-05T10:00:00.000Z";
const yesterday = "2026-10-04T10:00:00.000Z";
const order = (
  id: string,
  totalMinor: number,
  overrides: Partial<ReconciliationOrder> = {},
): ReconciliationOrder => ({
  id,
  kind: "ORDER",
  status: "SERVED",
  totalMinor,
  createdAt: today,
  ...overrides,
});
const payment = (
  id: string,
  orderId: string | null,
  amountMinor: number,
  overrides: Partial<ReconciliationPayment> = {},
): ReconciliationPayment => ({
  id,
  orderId,
  onlineOrderId: null,
  tableSessionId: null,
  amountMinor,
  method: "CASH",
  status: "RECORDED",
  recordedAt: today,
  ...overrides,
});
const reconcile = (
  orders: ReconciliationOrder[],
  payments: ReconciliationPayment[],
) =>
  reconcileDailyPayments({ date, timezone: "Europe/Berlin", orders, payments });

describe("creation-day and recording-day reconciliation", () => {
  it("explains €28.70 of orders, €12.20 pending and €47.50 of recordings without forcing equality", () => {
    const result = reconcile(
      [
        order("paid", 1650),
        order("pending", 1220),
        order("older", 3100, { createdAt: yesterday }),
      ],
      [
        payment("cash", "paid", 1650),
        payment("card", "older", 3100, { method: "CARD_AT_COUNTER" }),
      ],
    );
    expect(result).toEqual({
      ordersCreated: {
        count: 2,
        orderValueMinor: 2870,
        paidMinor: 1650,
        pendingMinor: 1220,
        unallocatedMinor: 0,
        overpaidMinor: 0,
        excludedCount: 0,
      },
      paymentsRecorded: {
        totalMinor: 4750,
        cashMinor: 1650,
        cardMinor: 3100,
        otherMinor: 0,
        todayOrdersMinor: 1650,
        otherPaymentsMinor: 3100,
        earlierOrdersMinor: 3100,
        tableSessionOnlyMinor: 0,
        excludedOrdersMinor: 0,
        unlinkedMinor: 0,
      },
    });
  });
  it("uses direct online links, counts all-time linked payments and deduplicates rows", () => {
    const online = order("online", 1200, { kind: "ONLINE_ORDER" });
    const laterPayment = payment("online-payment", null, 1200, {
      onlineOrderId: "online",
      recordedAt: "2026-10-06T10:00:00Z",
      method: "CARD_AT_TABLE",
    });
    const result = reconcile([online, online], [laterPayment, laterPayment]);
    expect(result.ordersCreated).toEqual({
      count: 1,
      orderValueMinor: 1200,
      paidMinor: 1200,
      pendingMinor: 0,
      unallocatedMinor: 0,
      overpaidMinor: 0,
      excludedCount: 0,
    });
    expect(result.paymentsRecorded.totalMinor).toBe(0);
  });
  it("separates cancelled, rejected, session-only and unlinked payments and ignores voids", () => {
    const result = reconcile(
      [
        order("cancel", 500, { status: "CANCELLED" }),
        order("reject", 700, { status: "REJECTED", kind: "ONLINE_ORDER" }),
      ],
      [
        payment("cancel-pay", "cancel", 500),
        payment("reject-pay", null, 700, { onlineOrderId: "reject" }),
        payment("session", null, 900, { tableSessionId: "session" }),
        payment("unlinked", null, 200, { method: "OTHER" }),
        payment("ambiguous", "cancel", 100, { onlineOrderId: "reject" }),
        payment("void", "cancel", 300, { status: "VOIDED" }),
      ],
    );
    expect(result.ordersCreated).toEqual({
      count: 0,
      orderValueMinor: 0,
      paidMinor: 0,
      pendingMinor: 0,
      unallocatedMinor: 0,
      overpaidMinor: 0,
      excludedCount: 2,
    });
    expect(result.paymentsRecorded).toEqual({
      totalMinor: 2400,
      cashMinor: 2200,
      cardMinor: 0,
      otherMinor: 200,
      todayOrdersMinor: 0,
      otherPaymentsMinor: 2400,
      earlierOrdersMinor: 0,
      tableSessionOnlyMinor: 900,
      excludedOrdersMinor: 1200,
      unlinkedMinor: 300,
    });
  });
  it("does not offset another order's outstanding amount with an overpayment", () => {
    const result = reconcile(
      [order("excess", 1000), order("due", 1000)],
      [payment("excess-pay", "excess", 1100)],
    );
    expect(result.ordersCreated).toEqual({
      count: 2,
      orderValueMinor: 2000,
      paidMinor: 1100,
      pendingMinor: 1000,
      unallocatedMinor: 0,
      overpaidMinor: 100,
      excludedCount: 0,
    });
  });
  it("uses inclusive start/exclusive end in the venue timezone", () => {
    const result = reconcile(
      [
        order("before", 100, { createdAt: "2026-10-04T21:59:59.999Z" }),
        order("start", 200, { createdAt: "2026-10-04T22:00:00.000Z" }),
        order("end", 300, { createdAt: "2026-10-05T22:00:00.000Z" }),
      ],
      [
        payment("start-pay", "start", 200, {
          recordedAt: "2026-10-04T22:00:00.000Z",
        }),
        payment("end-pay", "end", 300, {
          recordedAt: "2026-10-05T22:00:00.000Z",
        }),
      ],
    );
    expect(result.ordersCreated.count).toBe(1);
    expect(result.ordersCreated.orderValueMinor).toBe(200);
    expect(result.paymentsRecorded.totalMinor).toBe(200);
  });
});
describe("order payment state", () => {
  it("does not report session-only amounts as paid or known pending on an individual order", () => {
    const sessionOrder = order("session-order", 1000, {
      unallocatedSessionPayment: true,
    });
    const result = reconcile(
      [sessionOrder, order("session-order", 1000)],
      [payment("session-only", null, 1000, { tableSessionId: "session" })],
    );
    expect(result.ordersCreated).toEqual({
      count: 1,
      orderValueMinor: 1000,
      paidMinor: 0,
      pendingMinor: 0,
      unallocatedMinor: 1000,
      overpaidMinor: 0,
      excludedCount: 0,
    });
    expect(result.paymentsRecorded.tableSessionOnlyMinor).toBe(1000);
  });
  it("does not treat a voided record as paid", () => {
    expect(
      summarizeOrderPayment(1000, {
        status: "VOIDED",
        amountMinor: 1000,
        method: "CASH",
      }).paid,
    ).toBe(false);
  });
  it("recognizes a fully paid session without inventing an order allocation or double-counting direct payments", () => {
    expect(
      summarizeOrderPayment(1000, null, {
        orderTotals: [1000, 500],
        payments: [
          {
            orderId: null,
            onlineOrderId: null,
            amountMinor: 1500,
            method: "CASH",
          },
        ],
      }),
    ).toEqual({
      paid: true,
      paidMinor: 0,
      paymentMethods: ["CASH"],
      sessionPaymentMinor: 1500,
    });
    expect(
      summarizeOrderPayment(
        1000,
        { status: "RECORDED", amountMinor: 1000, method: "CARD_AT_COUNTER" },
        {
          orderTotals: [1000, 500],
          payments: [
            {
              orderId: "direct",
              onlineOrderId: null,
              amountMinor: 1000,
              method: "CARD_AT_COUNTER",
            },
          ],
        },
      ),
    ).toEqual({
      paid: true,
      paidMinor: 1000,
      paymentMethods: ["CARD_AT_COUNTER"],
      sessionPaymentMinor: 0,
    });
  });
});
