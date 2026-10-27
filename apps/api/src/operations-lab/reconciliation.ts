import { prisma } from "@flowgastronomie/database";
import { Prisma } from "@prisma/client";
import {
  businessDayUtcRange,
  type LabRun,
  type FinalReceipt,
  type DailyOperationsReport,
} from "@flowgastronomie/domain";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { assertLabScope, hash } from "./guard.js";
import { verifyArchive, type ArchiveEntry } from "./pdf-archive.js";
type Evidence = {
  event_id: string;
  run_id: string;
  kind: string;
  status: string;
  idempotency_key: string;
  browser_key: string | null;
  error_code: string | null;
  expected: Record<string, unknown>;
  result: Record<string, unknown> | null;
};
export function isLabOrderSource(
  order: {
    id: string;
    referenceCode: string | null;
    idempotencyKey: string | null;
  },
  action: Pick<
    Evidence,
    "expected" | "result" | "idempotency_key" | "browser_key"
  >,
) {
  return (
    action.expected.kind === "ORDER" &&
    Boolean(
      (action.result?.id && action.result.id === order.id) ||
      (action.result?.referenceCode &&
        action.result.referenceCode === order.referenceCode) ||
      action.idempotency_key === order.idempotencyKey ||
      (action.browser_key && action.browser_key === order.idempotencyKey),
    )
  );
}
export async function reconcile(run: LabRun, platform?: DailyOperationsReport) {
  await assertLabScope(run.tenantId, run.venueId);
  const scope = { tenantId: run.tenantId, venueId: run.venueId };
  const venue = await prisma.venue.findFirstOrThrow({
    where: { id: run.venueId, tenantId: run.tenantId },
  });
  const range = businessDayUtcRange(run.businessDate, venue.timezone),
    day = { gte: range.startsAt, lt: range.endsAt };
  const data = await prisma.$transaction(
    async (tx) => {
      const allActions = await tx.$queryRaw<
        Evidence[]
      >`SELECT a.event_id,a.run_id,a.kind,a.status,a.idempotency_key,a.browser_key,a.error_code,a.expected,a.result FROM operations_lab.action a JOIN operations_lab.run r ON r.id=a.run_id WHERE a.tenant_id=${run.tenantId} AND a.venue_id=${run.venueId} AND (r.business_date=${run.businessDate}::date OR r.id=${run.id})`;
      const actions = allActions.filter((a) => a.run_id === run.id);
      const ownOrderActions = actions.filter(
        (a) => a.expected.kind === "ORDER",
      );
      const ownKeys = ownOrderActions.flatMap((a) => [
        a.idempotency_key,
        ...(a.browser_key ? [a.browser_key] : []),
      ]);
      const orderIds = ownOrderActions.flatMap((a) =>
        typeof a.result?.id === "string" ? [a.result.id] : [],
      );
      const onlineRefs = ownOrderActions.flatMap((a) =>
        typeof a.result?.referenceCode === "string"
          ? [a.result.referenceCode]
          : [],
      );
      const orders = await tx.order.findMany({
        where: {
          ...scope,
          OR: [
            { createdAt: day },
            { id: { in: orderIds } },
            { idempotencyKey: { in: ownKeys } },
          ],
        },
        include: { items: true, productionTickets: true },
      });
      const online = await tx.onlineOrder.findMany({
        where: {
          ...scope,
          OR: [
            { createdAt: day },
            { referenceCode: { in: onlineRefs } },
            { idempotencyKey: { in: ownKeys } },
          ],
        },
        include: { items: true, productionTickets: true },
      });
      const ownPaymentIds = actions
        .filter((a) => a.expected.kind === "PAYMENT")
        .flatMap((a) =>
          typeof (a.result?.paymentId ?? a.result?.id) === "string"
            ? [String(a.result?.paymentId ?? a.result?.id)]
            : [],
        );
      const payments = await tx.paymentRecord.findMany({
        where: {
          ...scope,
          OR: [
            { recordedAt: day },
            { id: { in: ownPaymentIds } },
            { orderId: { in: orders.map((o) => o.id) } },
            { onlineOrderId: { in: online.map((o) => o.id) } },
          ],
        },
      });
      const receipts = await tx.receipt.findMany({
        where: {
          ...scope,
          OR: [{ issuedAt: day }, { paymentId: { in: ownPaymentIds } }],
        },
      });
      const jobs = await tx.printJob.findMany({
        where: { ...scope, receiptId: { in: receipts.map((r) => r.id) } },
      });
      const commands = await tx.hardwareCommandRecord.findMany({
        where: { ...scope, receiptId: { in: receipts.map((r) => r.id) } },
        select: { id: true, receiptId: true, kind: true, result: true },
      });
      const cash = await tx.cashSession.findMany({
        where: {
          ...scope,
          OR: [
            { openedAt: day },
            {
              id: {
                in: actions
                  .filter((a) => a.kind === "register-open")
                  .flatMap((a) => (a.result?.id ? [String(a.result.id)] : [])),
              },
            },
          ],
        },
      });
      const shifts = await tx.staffShift.findMany({
        where: {
          ...scope,
          OR: [
            { startedAt: day },
            {
              id: {
                in: actions
                  .filter((a) => a.kind.startsWith("shift-open-"))
                  .flatMap((a) => (a.result?.id ? [String(a.result.id)] : [])),
              },
            },
          ],
        },
      });
      const attendance = await tx.workforceAttendance.findMany({
        where: {
          ...scope,
          operationalStaffShiftId: { in: shifts.map((s) => s.id) },
        },
        include: { events: true },
      });
      const archives = receipts.length
        ? await tx.$queryRaw<
            ArchiveEntry[]
          >`SELECT * FROM operations_lab.archive WHERE tenant_id=${run.tenantId} AND venue_id=${run.venueId} AND receipt_id IN (${Prisma.join(receipts.map((r) => r.id))})`
        : [];
      return {
        allActions,
        actions,
        orders,
        online,
        payments,
        receipts,
        jobs,
        commands,
        cash,
        shifts,
        attendance,
        archives,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 30000 },
  );
  const archive = data.archives;
  const all = [
    ...data.orders.map((o) => ({
      ...o,
      channel:
        o.source === "STAFF_TABLET"
          ? o.tableId
            ? "STAFF_TABLE"
            : "COUNTER"
          : "QR",
      tickets: o.productionTickets,
      terminal: o.status === "SERVED",
      referenceCode: null,
    })),
    ...data.online.map((o) => ({
      ...o,
      channel: "WEBSITE",
      tickets: o.productionTickets,
      terminal: o.status === "COMPLETED",
      tableSessionId: null,
    })),
  ];
  const sourceAction = (order: (typeof all)[number], actions: Evidence[]) =>
    actions.find((a) => isLabOrderSource(order, a));
  const owned = all.filter((o) => sourceAction(o, data.actions));
  const recordedAll = data.payments.filter((p) => p.status === "RECORDED");
  const paymentActions = data.actions.filter(
    (a) => a.expected.kind === "PAYMENT",
  );
  const paymentIds = paymentActions.map((a) =>
    String(a.result?.paymentId ?? a.result?.id ?? ""),
  );
  const recorded = recordedAll.filter((p) => paymentIds.includes(p.id));
  const receipts = data.receipts.filter((r) =>
    paymentIds.includes(r.paymentId),
  );
  const jobs = data.jobs.filter((j) =>
    receipts.some((r) => r.id === j.receiptId),
  );
  const commands = data.commands.filter((c) =>
    receipts.some((r) => r.id === c.receiptId),
  );
  const shiftIds = data.actions
    .filter((a) => a.kind.startsWith("shift-open-"))
    .map((a) => String(a.result?.id ?? ""));
  const shifts = data.shifts.filter((s) => shiftIds.includes(s.id));
  const attendance = data.attendance.filter(
    (a) =>
      a.operationalStaffShiftId && shiftIds.includes(a.operationalStaffShiftId),
  );
  const registerIds = data.actions
    .filter((a) => a.kind === "register-open")
    .map((a) => String(a.result?.id ?? ""));
  const cash = data.cash.filter((c) => registerIds.includes(c.id));
  const expectedOrders = data.actions.filter(
    (a) => a.expected.kind === "ORDER",
  );
  const discrepancies: string[] = [],
    check = (ok: boolean, reason: string) => {
      if (!ok) discrepancies.push(reason);
    };
  check(
    owned.length === expectedOrders.length,
    "Simulator order count differs from intended actions",
  );
  for (const action of expectedOrders) {
    const order = owned.find((o) => sourceAction(o, [action]));
    check(!!order, "Missing simulator order " + action.kind);
    if (!order) continue;
    const e = action.expected,
      items = e.items as Array<{
        productId: string;
        quantity: number;
        unitMinor: number;
        station?: string;
        notes?: string;
      }>;
    check(
      order.totalMinor === e.totalMinor && order.currency === e.currency,
      "Order money/currency mismatch " + order.id,
    );
    check(order.channel === e.channel, "Order channel mismatch " + order.id);
    check(
      e.cancel ? order.status === "CANCELLED" : order.terminal,
      "Unfinished scenario order " + order.id,
    );
    check(
      order.items.length === items.length,
      "Item count mismatch " + order.id,
    );
    for (const i of items) {
      const actual = order.items.find((l) => l.productId === i.productId);
      check(
        !!actual &&
          actual.quantity === i.quantity &&
          actual.unitPriceMinor === i.unitMinor,
        "Immutable basket mismatch " + order.id,
      );
    }
    const stations = items.some((i) => i.station)
      ? [...new Set(items.map((i) => i.station))]
      : ["KITCHEN", "BAR"];
    check(
      order.tickets.length === stations.length &&
        stations.every((s) => order.tickets.some((t) => t.station === s)),
      "Ticket routing mismatch " + order.id,
    );
    if (!e.cancel)
      check(
        order.tickets.every(
          (t) =>
            t.status === (order.channel === "WEBSITE" ? "READY" : "SERVED"),
        ),
        "Unfinished production " + order.id,
      );
  }
  check(
    recorded.length === paymentActions.length,
    "Simulator payment count mismatch",
  );
  for (const action of paymentActions) {
    const e = action.expected,
      p = recorded.find(
        (p) => p.id === (action.result?.paymentId ?? action.result?.id),
      );
    check(
      !!p && p.amountMinor === e.amountMinor && p.method === e.method,
      "Payment amount/method mismatch " + action.kind,
    );
    if (p && e.receivedMinor !== undefined)
      check(
        p.receivedMinor === e.receivedMinor && p.changeMinor === e.changeMinor,
        "Cash received/change mismatch " + p.id,
      );
    if (e.allocation === "SESSION_ONLY_NO_RECEIPT")
      check(
        !!p &&
          !p.orderId &&
          !p.onlineOrderId &&
          !receipts.some((r) => r.paymentId === p.id),
        "Fabricated session allocation/receipt",
      );
  }
  const expectedReceiptCount = paymentActions.filter(
    (a) => a.expected.allocation !== "SESSION_ONLY_NO_RECEIPT",
  ).length;
  check(
    receipts.length === expectedReceiptCount,
    "Final receipt count mismatch",
  );
  for (const r of receipts) {
    const p = recorded.find((p) => p.id === r.paymentId),
      s = r.snapshot as unknown as FinalReceipt;
    const order = owned.find((o) => o.id === (r.orderId ?? r.onlineOrderId)),
      action = order ? sourceAction(order, data.actions) : undefined;
    const items = action?.expected.items as
      Array<{ unitMinor: number; quantity: number }> | undefined;
    const rate =
      venue.countryCode === "DE"
        ? order?.channel === "STAFF_TABLE"
          ? 1900
          : 700
        : 2000;
    const expectedNet = items?.reduce(
      (n, i) =>
        n +
        Number(
          (BigInt(i.unitMinor * i.quantity) * 10000n +
            BigInt(10000 + rate) / 2n) /
            BigInt(10000 + rate),
        ),
      0,
    );
    check(
      r.status === "FINALIZED" &&
        !!p &&
        s.grossMinor === p.amountMinor &&
        s.currency === venue.currency,
      "Receipt/payment mismatch " + r.id,
    );
    check(
      s.netMinor === expectedNet &&
        s.taxMinor === s.grossMinor - (expectedNet ?? 0),
      "Immutable tax mismatch " + r.id,
    );
    check(
      !r.fiscalTransactionId && !r.tseSerial && !r.signature,
      "Unexpected fiscal fields",
    );
    const a = archive.find((a) => a.receipt_id === r.id);
    check(!!a, "Missing PDF " + r.id);
    if (a) {
      const canonical = {
        ...s,
        id: r.id,
        number: r.number,
        orderId: r.orderId,
        onlineOrderId: r.onlineOrderId,
        paymentId: r.paymentId,
        issuedAt: r.issuedAt.toISOString(),
        finalizedAt: r.finalizedAt.toISOString(),
        status: r.status,
      };
      check(
        a.source_hash === hash(JSON.stringify(canonical)),
        "PDF source hash mismatch " + r.id,
      );
      try {
        await verifyArchive(a);
      } catch {
        discrepancies.push("PDF bytes/hash mismatch " + r.id);
      }
    }
    check(
      jobs.some((j) => j.receiptId === r.id && j.status === "PRINTED"),
      "Unconfirmed PDF print " + r.id,
    );
  }
  for (const c of cash) {
    const expected =
      c.openingCashMinor +
      recordedAll
        .filter((p) => p.cashSessionId === c.id && p.method === "CASH")
        .reduce((n, p) => n + p.amountMinor, 0);
    check(
      c.status === "CLOSED" &&
        c.expectedCashMinor === expected &&
        c.countedCashMinor === expected &&
        c.differenceMinor === 0,
      "Register discrepancy " + c.id,
    );
  }
  check(cash.length === 1, "Simulator register session missing");
  check(
    shifts.length === shiftIds.length &&
      shifts.every((s) => s.status === "CLOSED"),
    "Simulator operational shifts incomplete",
  );
  check(
    attendance.length === shifts.length &&
      attendance.every(
        (a) =>
          a.state === "CLOSED" &&
          a.events.some((e) => e.kind === "CLOCK_IN") &&
          a.events.some((e) => e.kind === "CLOCK_OUT"),
      ),
    "Workforce attendance/linkage incomplete",
  );
  const unresolvedActions = data.actions.filter(
    (a) => a.status !== "SUCCEEDED",
  ).length;
  check(unresolvedActions === 0, "Unresolved simulator actions");
  check(
    commands.some(
      (c) =>
        (c.result as { errorCode?: string } | null)?.errorCode === "PAPER_OUT",
    ),
    "Printer fault evidence missing",
  );
  check(
    jobs.some((j) => j.attempts >= 2),
    "Printer retry evidence missing",
  );
  const drawer = commands.filter((c) => c.kind === "openDrawer");
  check(
    new Set(drawer.map((c) => c.receiptId)).size === drawer.length,
    "Duplicate cash drawer command",
  );
  const eligible = owned.filter(
    (o) => !["CANCELLED", "REJECTED"].includes(o.status),
  );
  const direct = recorded.filter((p) => p.orderId || p.onlineOrderId);
  const session = recorded.filter(
    (p) => !p.orderId && !p.onlineOrderId && p.tableSessionId,
  );
  const inDay = (date: Date) => date >= range.startsAt && date < range.endsAt;
  const totals = {
    orderValueMinor: eligible.reduce((n, o) => n + o.totalMinor, 0),
    directPaidMinor: direct.reduce((n, p) => n + p.amountMinor, 0),
    unallocatedOrderValueMinor: eligible
      .filter((o) => o.channel === "QR")
      .reduce((n, o) => n + o.totalMinor, 0),
    sessionOnlyPaymentMinor: session.reduce((n, p) => n + p.amountMinor, 0),
    paymentsRecordedMinor: recorded
      .filter((p) => inDay(p.recordedAt))
      .reduce((n, p) => n + p.amountMinor, 0),
    cashMinor: recorded
      .filter((p) => inDay(p.recordedAt) && p.method === "CASH")
      .reduce((n, p) => n + p.amountMinor, 0),
    cardMinor: recorded
      .filter((p) => inDay(p.recordedAt) && p.method === "CARD_AT_COUNTER")
      .reduce((n, p) => n + p.amountMinor, 0),
    cashReceivedMinor: recorded
      .filter((p) => p.method === "CASH" && p.receivedMinor !== null)
      .reduce((n, p) => n + (p.receivedMinor ?? 0), 0),
    changeMinor: recorded.reduce((n, p) => n + (p.changeMinor ?? 0), 0),
  };
  const dayOrders = all.filter(
    (o) => inDay(o.createdAt) && !["CANCELLED", "REJECTED"].includes(o.status),
  );
  const dayPayments = recordedAll.filter((p) => inDay(p.recordedAt));
  const dayDirect = recordedAll.filter((p) =>
    dayOrders.some((o) => o.id === (p.orderId ?? p.onlineOrderId)),
  );
  const dayUnallocated = dayOrders
    .filter(
      (o) =>
        !dayDirect.some((p) => (p.orderId ?? p.onlineOrderId) === o.id) &&
        o.tableSessionId &&
        recordedAll.some(
          (p) =>
            p.tableSessionId === o.tableSessionId &&
            !p.orderId &&
            !p.onlineOrderId,
        ),
    )
    .reduce((n, o) => n + o.totalMinor, 0);
  const dayTotals = {
    orderValueMinor: dayOrders.reduce((n, o) => n + o.totalMinor, 0),
    directPaidMinor: dayDirect.reduce((n, p) => n + p.amountMinor, 0),
    unallocatedOrderValueMinor: dayUnallocated,
    paymentsRecordedMinor: dayPayments.reduce((n, p) => n + p.amountMinor, 0),
    cashMinor: dayPayments
      .filter((p) => p.method === "CASH")
      .reduce((n, p) => n + p.amountMinor, 0),
    cardMinor: dayPayments
      .filter((p) => ["CARD_AT_COUNTER", "CARD_AT_TABLE"].includes(p.method))
      .reduce((n, p) => n + p.amountMinor, 0),
  };
  if (platform?.reconciliation) {
    const p = platform.reconciliation;
    check(
      p.ordersCreated.orderValueMinor === dayTotals.orderValueMinor &&
        p.ordersCreated.paidMinor === dayTotals.directPaidMinor &&
        p.ordersCreated.unallocatedMinor ===
          dayTotals.unallocatedOrderValueMinor,
      "Canonical creation-day report mismatch",
    );
    check(
      p.paymentsRecorded.totalMinor === dayTotals.paymentsRecordedMinor &&
        p.paymentsRecorded.cashMinor === dayTotals.cashMinor &&
        p.paymentsRecorded.cardMinor === dayTotals.cardMinor,
      "Canonical recording-day report mismatch",
    );
  }
  const external = all.filter(
    (o) => inDay(o.createdAt) && !sourceAction(o, data.allActions),
  );
  const isSmoke = run.scenarioVersion === "lab1-day-v1";
  const filename = isSmoke
    ? `artifacts/operations-lab/${venue.countryCode}-${run.businessDate}-reconciliation.json`
    : `artifacts/operations-lab/normal-day/${venue.countryCode}-${run.id}-reconciliation.json`;
  await mkdir(dirname(filename), { recursive: true });
  const waits = eligible
    .flatMap((o) =>
      o.tickets
        .filter((t) => t.readyAt)
        .map((t) => (t.readyAt!.getTime() - o.createdAt.getTime()) / 1000),
    )
    .sort((a, b) => a - b);
  const report = {
    version: 2,
    runId: run.id,
    scenarioVersion: run.scenarioVersion,
    businessDate: run.businessDate,
    timezone: venue.timezone,
    tenantId: run.tenantId,
    venueId: run.venueId,
    currency: venue.currency,
    clocks: { orders: "creation date", payments: "recording date", range },
    counts: {
      orders: owned.length,
      tickets: owned.reduce((n, o) => n + o.tickets.length, 0),
      payments: recorded.length,
      receipts: receipts.length,
      pdfs: receipts.filter((r) => archive.some((a) => a.receipt_id === r.id))
        .length,
      printJobs: jobs.length,
      printed: jobs.filter((j) => j.status === "PRINTED").length,
      failed: jobs.filter((j) => j.status === "FAILED").length,
      operationalShifts: shifts.length,
      attendance: attendance.length,
      cancelled: owned.filter((o) => o.status === "CANCELLED").length,
    },
    provenance: Object.fromEntries(
      ["STAFF_POS", "TABLE_QR", "WEBSITE_API", "WEBSITE_BROWSER"].map((key) => [
        key,
        expectedOrders.filter((a) => a.expected.provenance === key).length,
      ]),
    ),
    channels: Object.fromEntries(
      ["COUNTER", "STAFF_TABLE", "QR", "WEBSITE"].map((ch) => [
        ch,
        owned.filter((o) => o.channel === ch).length,
      ]),
    ),
    waiting: {
      actualSeconds: waits,
      medianSeconds: waits[Math.floor(waits.length / 2)] ?? 0,
      p95Seconds: waits[Math.floor(waits.length * 0.95)] ?? 0,
      maximumSeconds: waits.at(-1) ?? 0,
    },
    totals,
    dayTotals,
    externalActivity: {
      orders: external.map((o) => ({
        id: o.id,
        source: o.channel,
        status: o.status,
        totalMinor: o.totalMinor,
      })),
      classification:
        "Canonical activity without a simulator action; reported separately, not missing simulator output.",
    },
    cash: cash.map((c) => ({
      id: c.id,
      status: c.status,
      opening: c.openingCashMinor,
      expected: c.expectedCashMinor,
      counted: c.countedCashMinor,
      difference: c.differenceMinor,
    })),
    orders: owned.map((o) => ({
      id: o.id,
      source: o.channel,
      status: o.status,
      totalMinor: o.totalMinor,
      tickets: o.tickets.map((t) => ({
        id: t.id,
        station: t.station,
        status: t.status,
      })),
    })),
    receipts: receipts.map((r) => ({
      id: r.id,
      number: r.number,
      paymentId: r.paymentId,
      archive: archive.find((a) => a.receipt_id === r.id),
    })),
    hardware: {
      paperOutAttempts: commands.filter(
        (c) =>
          (c.result as { errorCode?: string } | null)?.errorCode ===
          "PAPER_OUT",
      ).length,
      retriedJobs: jobs.filter((j) => j.attempts >= 2).map((j) => j.id),
      drawerCommands: drawer.map((c) => c.id),
    },
    limitations: [
      "Session-only payments remain unallocated and have no fabricated P2 receipt.",
      "Register cash excludes session payments without a cashSessionId.",
      "Truthful wall timestamps; compressed volume is not eight elapsed operating hours.",
      "No physical printer/card processing/fiscalization/provider delivery.",
    ],
    unresolvedActions,
    incidents: data.actions
      .filter((a) => a.error_code)
      .map((a) => ({
        eventId: a.event_id,
        action: a.kind,
        code: a.error_code,
        resolved: a.status === "SUCCEEDED",
        explanation:
          a.error_code === "OBSERVED_BROWSER_RECOVERY"
            ? "The original browser order was observed through its native request identity and genuine tracking UI; it was not submitted again."
            : "An action required retry/review; its persisted outcome is retained.",
      })),
    discrepancies,
    filename,
  };
  await writeFile(filename, JSON.stringify(report, null, 2));
  await writeFile(
    filename.replace(".json", ".csv"),
    "metric,value\n" +
      Object.entries({ ...report.counts, ...totals })
        .map(([k, v]) => k + "," + v)
        .join("\n") +
      "\n",
  );
  return report;
}
