import { prisma } from "@flowgastronomie/database";
import {
  assertLabCompletion,
  type FinalReceipt,
  type SimplePilotOrder,
  type DailyOperationsReport,
} from "@flowgastronomie/domain";
import { mkdir } from "node:fs/promises";
import { assertLabApi, LabClient, LabHttpError } from "./client.js";
import { assertLabInstance, assertLabScope } from "./guard.js";
import { openRun, Actions } from "./actions.js";
import {
  provision,
  saveLocal,
  type Profile,
  type PosMenu,
} from "./provision.js";
import { reconcile } from "./reconcile.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function day(profile: Profile) {
  const { state, clients, publicSlug, date, prices } = await provision(profile);
  const staff = state.actors.owner!.staff!;
  const run = await openRun(staff.tenantId, staff.venueId, date);
  if (
    run.status === "COMPLETED" ||
    (run.status === "NEEDS_REVIEW" && process.argv.includes("--recheck"))
  ) {
    const platform = await clients.manager!.request<DailyOperationsReport>(
      "GET",
      `/v1/staff/reports/daily?date=${date}`,
    );
    const report = await reconcile(run, platform);
    if (report.discrepancies.length) throw new Error("LAB_RECHECK_DISCREPANCY");
    if (run.status === "NEEDS_REVIEW") {
      assertLabCompletion(
        run.status,
        report.unresolvedActions,
        report.discrepancies.length,
      );
      await assertLabScope(run.tenantId, run.venueId);
      await prisma.$executeRaw`UPDATE operations_lab.run SET status='COMPLETED',checkpoint=${JSON.stringify({ report: report.filename, review: "CLI recheck: all scenario actions and independent reconciliation passed" })}::jsonb,updated_at=now()
        WHERE id=${run.id} AND tenant_id=${run.tenantId} AND venue_id=${run.venueId} AND status='NEEDS_REVIEW'`;
    }
    console.log(
      JSON.stringify({
        profile,
        replayed: true,
        counts: report.counts,
        totals: report.totals,
        discrepancies: report.discrepancies,
        report: report.filename,
      }),
    );
    return;
  }
  if (!["RUNNING", "STOP_AFTER_SHIFT"].includes(run.status))
    throw new Error("LAB_RUN_REVIEW_REQUIRED");
  const actions = new Actions(
      run,
      Object.fromEntries(
        Object.entries(state.actors)
          .filter(([, a]) => a.staff)
          .map(([key, a]) => [
            key,
            {
              membershipId: a.staff!.membershipId,
              sessionId: a.staff!.sessionId,
            },
          ]),
      ),
    ),
    manager = clients.manager!,
    waiter = clients.waiter!;
  const call = <T>(
    name: string,
    actor: string,
    path: string,
    body: unknown,
    idempotent = false,
    method = "POST",
    expected: Record<string, unknown> = {},
  ) =>
    actions.perform<T>(
      name,
      actor,
      { path, body, method },
      expected,
      idempotent,
      (key) =>
        clients[actor]!.request<T>(method, path, body, {
          "idempotency-key": key,
        }),
    );
  const actors = ["manager", "waiter", "kitchen", "bar"];
  for (const actor of actors) {
    const shift = await call<{ id: string }>(
      "shift-open-" + actor,
      actor,
      "/v1/staff/shift/start",
      { note: "TEST ONLY lab operational shift" },
    );
    await actions.perform(
      "clock-in-" + actor,
      actor,
      { kind: "CLOCK_IN" },
      {},
      true,
      (key) =>
        clients[actor]!.request(
          "POST",
          "/v1/staff/workforce/attendance/punch",
          {
            kind: "CLOCK_IN",
            expectedVersion: 0,
            idempotencyKey: key,
            operationalStaffShiftId: shift.id,
          },
        ),
    );
  }
  const openingCashMinor = profile === "DE" ? 10000 : 1000000;
  const cashSession = await call<{ id: string }>(
    "register-open",
    "manager",
    "/v1/staff/register/open",
    { openingCashMinor, openingNote: "TEST ONLY" },
  );
  const devices = await manager.request<{
    devices: Array<{ id: string; mode: string }>;
  }>("GET", "/v1/staff/hardware/devices");
  const device =
    devices.devices.find((d) => d.mode === "SIMULATOR") ??
    (await call<{ id: string }>(
      "pair-simulator",
      "manager",
      "/v1/staff/hardware/pair",
      { mode: "SIMULATOR", displayName: "TEST ONLY PDF simulator" },
    ));
  await manager.request("PUT", `/v1/staff/hardware/devices/${device.id}`, {
    active: true,
    autoPrint: false,
    autoDrawer: false,
  });
  const menu = await waiter.request<PosMenu>(
    "GET",
    "/v1/staff/pos/menu?locale=en",
  );
  const products = menu.categories.flatMap((c) => c.products),
    food = products.find((p) => p.name === "TEST ONLY Pizza Margherita")!,
    drink = products.find((p) => p.name === "TEST ONLY Limonade")!;
  if (!food || !drink) throw new Error("LAB_MENU_MISSING");
  const variant = food.variants.find((v) => v.priceDeltaMinor > 0)!,
    modifier = food.modifierGroups[0]!.options[0]!;
  const foodExtra = profile === "DE" ? 300 : 15000;
  // Independent expected money comes from authored scenario prices, never API totals.
  const recipes = [
    {
      name: "counter-cash",
      type: "TAKEAWAY",
      method: "CASH",
      items: [
        {
          productId: food.id,
          quantity: 2,
          variantId: variant.id,
          modifierOptionIds: [modifier.id],
          notes: "TEST ONLY extra cheese",
        },
        { productId: drink.id, quantity: 1 },
      ],
      expected: 2 * (prices[0]! + foodExtra) + prices[1]!,
    },
    {
      name: "table-card",
      type: "DINE_IN",
      method: "CARD_AT_COUNTER",
      items: [
        { productId: food.id, quantity: 1 },
        { productId: drink.id, quantity: 2 },
      ],
      expected: prices[0]! + 2 * prices[1]!,
    },
  ];
  async function print(name: string, receipt: FinalReceipt, fault: boolean) {
    const job = await actions.perform<{ id: string }>(
      "print-queue-" + name,
      "manager",
      { receiptId: receipt.id, deviceId: device.id },
      { receiptId: receipt.id },
      true,
      (key) =>
        manager.request("POST", "/v1/staff/hardware/jobs", {
          receiptId: receipt.id,
          deviceId: device.id,
          key,
        }),
    );
    if (fault) {
      await actions.perform(
        "paper-out-" + name,
        "manager",
        { deviceId: device.id },
        { failure: "PAPER_OUT" },
        true,
        async () => {
          await manager.request(
            "POST",
            `/v1/staff/hardware/simulator/${device.id}/diagnostics`,
            { nextPrintFailure: "PAPER_OUT" },
          );
          return { injected: true };
        },
      );
      const failed = await call<{
        job: { status: string; lastErrorCode: string };
      }>(
        "print-failed-" + name,
        "manager",
        `/v1/staff/hardware/jobs/${job.id}/execute`,
        { retry: false },
        true,
      );
      if (
        failed.job.status !== "FAILED" ||
        failed.job.lastErrorCode !== "PAPER_OUT"
      )
        throw new Error("LAB_PAPER_OUT_NOT_OBSERVED");
    }
    const printed = await call<{ job: { status: string } }>(
      "print-success-" + name,
      "manager",
      `/v1/staff/hardware/jobs/${job.id}/execute`,
      { retry: fault },
      true,
    );
    if (printed.job.status !== "PRINTED")
      throw new Error("LAB_PDF_NOT_PRINTED");
    // Reprint uses the same finalized receipt and archive identity.
    const copy = await actions.perform<{ id: string }>(
      "reprint-queue-" + name,
      "manager",
      { receiptId: receipt.id },
      { receiptId: receipt.id },
      true,
      (key) =>
        manager.request("POST", "/v1/staff/hardware/jobs", {
          receiptId: receipt.id,
          deviceId: device.id,
          key,
        }),
    );
    await call(
      "reprint-" + name,
      "manager",
      `/v1/staff/hardware/jobs/${copy.id}/execute`,
      { retry: false },
      true,
    );
    if (receipt.method === "CASH") {
      const input = {
        deviceId: device.id,
        kind: "openDrawer",
        receiptId: receipt.id,
      };
      await actions.perform(
        "drawer-" + name,
        "manager",
        input,
        { receiptId: receipt.id },
        true,
        (key) =>
          manager.request("POST", "/v1/staff/hardware/command", {
            ...input,
            key,
          }),
      );
      await actions.perform(
        "drawer-replay-" + name,
        "manager",
        input,
        { receiptId: receipt.id },
        true,
        (key) =>
          manager.request("POST", "/v1/staff/hardware/command", {
            ...input,
            key,
          }),
      );
    }
  }
  async function produce(name: string, orderId: string, online = false) {
    for (const station of ["KITCHEN", "BAR"]) {
      const actor = station === "KITCHEN" ? "kitchen" : "bar",
        client = clients[actor]!;
      const order = (
        await manager.request<SimplePilotOrder[]>(
          "GET",
          "/v1/staff/pilot/orders?view=TODAY",
        )
      ).find((o) => o.id === orderId)!;
      const ticket = order.tickets.find((t) => t.station === station);
      if (!ticket) continue;
      for (const status of ["PREPARING", "READY"])
        await actions.perform(
          `${name}-${station}-${status}`,
          actor,
          { ticketId: ticket.id, status },
          { orderId, station, status },
          true,
          async () => {
            // Observe the canonical state when recovering a lost HTTP response.
            const current = (
              await manager.request<SimplePilotOrder[]>(
                "GET",
                "/v1/staff/pilot/orders?view=TODAY",
              )
            )
              .find((o) => o.id === orderId)!
              .tickets.find((t) => t.id === ticket.id)!;
            if (
              current.status === status ||
              current.status === "SERVED" ||
              (status === "PREPARING" && current.status === "READY")
            )
              return { id: ticket.id, status: current.status, recovered: true };
            if (online) {
              const visible = await client.request<Array<{ id: string }>>(
                "GET",
                `/v1/staff/online-production/${station}`,
              );
              if (!visible.some((t) => t.id === ticket.id)) {
                console.log(
                  `${profile}: waiting for real pickup production gate`,
                );
                for (let i = 0; i < 20; i++) {
                  await delay(1000);
                  if (
                    (
                      await client.request<Array<{ id: string }>>(
                        "GET",
                        `/v1/staff/online-production/${station}`,
                      )
                    ).some((t) => t.id === ticket.id)
                  )
                    break;
                  if (i === 19) throw new Error("LAB_PICKUP_GATE_STILL_CLOSED");
                }
              }
            }
            if (status === "READY") await delay(250);
            const path = `/v1/staff/${online ? "online-production" : "production"}-tickets/${ticket.id}/status`;
            await client.request("PATCH", path, {
              status,
              expectedVersion: current.version,
            });
            return { id: ticket.id, status };
          },
        );
    }
  }
  const receipts: FinalReceipt[] = [];
  for (const recipe of recipes) {
    const body = {
      orderType: recipe.type,
      ...(recipe.type === "DINE_IN" ? { tableId: state.tableId } : {}),
      locale: "en",
      items: recipe.items,
    };
    const order = await actions.perform<{ id: string; totalMinor: number }>(
      "order-" + recipe.name,
      "waiter",
      body,
      {
        kind: "ORDER",
        channel: recipe.type === "DINE_IN" ? "STAFF_TABLE" : "COUNTER",
        totalMinor: recipe.expected,
        currency: profile === "DE" ? "EUR" : "ALL",
        items: recipe.items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitMinor:
            i.productId === food.id
              ? prices[0]! + (i.variantId ? foodExtra : 0)
              : prices[1]!,
        })),
      },
      true,
      (key) =>
        waiter.request("POST", "/v1/staff/orders", body, {
          "idempotency-key": key,
        }),
    );
    if (order.totalMinor !== recipe.expected)
      throw new Error("LAB_ORDER_ORACLE_MISMATCH");
    // Duplicate submission is a real HTTP replay, not a local cached result.
    const duplicate = await waiter.request<{ id: string }>(
      "POST",
      "/v1/staff/orders",
      body,
      { "idempotency-key": actions.key("order-" + recipe.name) },
    );
    if (duplicate.id !== order.id) throw new Error("LAB_DUPLICATE_ORDER");
    await produce(recipe.name, order.id);
    const payment =
      recipe.method === "CASH"
        ? { method: "CASH", receivedMinor: recipe.expected + 500 }
        : { method: "CARD_AT_COUNTER", terminalConfirmed: true };
    const receipt = await call<FinalReceipt>(
      "payment-" + recipe.name,
      "waiter",
      `/v1/staff/pos/orders/${order.id}/payment`,
      payment,
      true,
      "POST",
      {
        kind: "PAYMENT",
        orderId: order.id,
        amountMinor: recipe.expected,
        method: recipe.method,
      },
    );
    const again = await waiter.request<FinalReceipt>(
      "POST",
      `/v1/staff/pos/orders/${order.id}/payment`,
      payment,
      { "idempotency-key": actions.key("payment-" + recipe.name) },
    );
    if (again.id !== receipt.id || again.paymentId !== receipt.paymentId)
      throw new Error("LAB_DUPLICATE_PAYMENT");
    await call(
      "handoff-" + recipe.name,
      "waiter",
      `/v1/staff/pos/orders/${order.id}/complete`,
      undefined,
      true,
    );
    const finalized = await waiter.request<FinalReceipt>(
      "GET",
      `/v1/staff/receipts/${receipt.id}`,
    );
    await print(recipe.name, finalized, recipe.method === "CASH");
    receipts.push(finalized);
  }
  // Public pickup uses the canonical legacy timestamp contract, with real lead time.
  const onlineBody = {
    locale: "en",
    fulfillmentType: "PICKUP",
    contact: {
      name: "TEST ONLY Synthetic Guest",
      phone: "TEST-ONLY-0000",
      email: `guest.${profile.toLowerCase()}@operations-lab.invalid`,
    },
    items: [
      { productId: food.id, quantity: 1 },
      { productId: drink.id, quantity: 1 },
    ],
  };
  const onlineExpected = prices[0]! + prices[1]!;
  const submitted = await actions.perform<{ referenceCode: string }>(
    "order-online",
    "guest",
    onlineBody,
    {
      kind: "ORDER",
      channel: "WEBSITE",
      totalMinor: onlineExpected,
      currency: profile === "DE" ? "EUR" : "ALL",
      items: onlineBody.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitMinor: i.productId === food.id ? prices[0] : prices[1],
      })),
    },
    true,
    async (key) => {
      const result = await new LabClient().request<{ referenceCode: string }>(
        "POST",
        `/v1/public/online-orders/${publicSlug}`,
        {
          ...onlineBody,
          idempotencyKey: key,
          requestedFor: new Date(Date.now() + 65000).toISOString(),
        },
      );
      // Never persist tracking credentials into action evidence.
      return { referenceCode: result.referenceCode };
    },
  );
  const online = (
    await manager.request<SimplePilotOrder[]>(
      "GET",
      "/v1/staff/pilot/orders?view=TODAY",
    )
  ).find((o) => o.reference === submitted.referenceCode)!;
  if (!online || online.totalMinor !== onlineExpected)
    throw new Error("LAB_ONLINE_ORACLE_MISMATCH");
  await actions.perform(
    "online-accept",
    "manager",
    { id: online.id },
    { orderId: online.id },
    true,
    async () => {
      const current = (
        await manager.request<SimplePilotOrder[]>(
          "GET",
          "/v1/staff/pilot/orders?view=TODAY",
        )
      ).find((o) => o.id === online.id)!;
      if (current.lifecycleStatus === "PENDING_CONFIRMATION")
        await manager.request(
          "PATCH",
          `/v1/staff/online-orders/${online.id}/status`,
          { status: "ACCEPTED", note: "TEST ONLY accepted" },
        );
      return { id: online.id };
    },
  );
  await produce("online", online.id, true);
  const onlineReceipt = await call<FinalReceipt>(
    "payment-online",
    "waiter",
    `/v1/staff/online-orders/${online.id}/payment`,
    { method: "CARD_AT_COUNTER", terminalConfirmed: true },
    true,
    "POST",
    {
      kind: "PAYMENT",
      onlineOrderId: online.id,
      amountMinor: onlineExpected,
      method: "CARD_AT_COUNTER",
    },
  );
  await actions.perform(
    "online-handoff",
    "manager",
    { id: online.id },
    { orderId: online.id },
    true,
    async () => {
      const current = (
        await manager.request<SimplePilotOrder[]>(
          "GET",
          "/v1/staff/pilot/orders?view=TODAY",
        )
      ).find((o) => o.id === online.id)!;
      if (current.lifecycleStatus !== "COMPLETED")
        await manager.request(
          "PATCH",
          `/v1/staff/online-orders/${online.id}/status`,
          { status: "COMPLETED" },
        );
      return { id: online.id };
    },
  );
  await print(
    "online",
    await waiter.request<FinalReceipt>(
      "GET",
      `/v1/staff/receipts/${onlineReceipt.id}`,
    ),
    false,
  );
  receipts.push(onlineReceipt);
  // The independent QR session has genuine session payment, intentionally no P2 receipt.
  if (
    !state.guestSession ||
    (state.guestBusinessDate && state.guestBusinessDate !== date)
  ) {
    state.guestSession = await new LabClient().request(
      "POST",
      `/v1/public/tables/${state.qrToken}/sessions`,
    );
    await saveLocal(profile, state);
  }
  state.guestBusinessDate = date;
  await saveLocal(profile, state);
  const guest = state.guestSession!;
  const qrBody = {
    locale: "en",
    items: [
      { productId: food.id, quantity: 1 },
      { productId: drink.id, quantity: 1 },
    ],
  };
  const qr = await actions.perform<{ id: string }>(
    "order-qr",
    "guest",
    qrBody,
    {
      kind: "ORDER",
      channel: "QR",
      totalMinor: onlineExpected,
      currency: profile === "DE" ? "EUR" : "ALL",
      items: qrBody.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitMinor: i.productId === food.id ? prices[0] : prices[1],
      })),
    },
    true,
    (key) =>
      new LabClient().request(
        "POST",
        `/v1/public/sessions/${guest.sessionId}/orders`,
        qrBody,
        { "x-guest-token": guest.guestToken, "idempotency-key": key },
      ),
  );
  await actions.perform(
    "qr-accept",
    "manager",
    { id: qr.id },
    { orderId: qr.id },
    true,
    async () => {
      const current = (
        await manager.request<SimplePilotOrder[]>(
          "GET",
          "/v1/staff/pilot/orders?view=TODAY",
        )
      ).find((o) => o.id === qr.id)!;
      if (current.lifecycleStatus === "NEW") {
        // Canonical order optimistic version is read from the original scoped radar.
        const radar = await manager.request<{
          signals: Array<{ order?: { id: string; version: number } }>;
        }>("GET", "/v1/staff/radar");
        const version = radar.signals.find((s) => s.order?.id === qr.id)?.order
          ?.version;
        if (!version) throw new Error("LAB_QR_VERSION_MISSING");
        await manager.request("PATCH", `/v1/staff/orders/${qr.id}/status`, {
          status: "ACCEPTED",
          expectedVersion: version,
        });
      }
      return { id: qr.id };
    },
  );
  await produce("qr", qr.id);
  const qrProjection = (
    await manager.request<SimplePilotOrder[]>(
      "GET",
      "/v1/staff/pilot/orders?view=TODAY",
    )
  ).find((o) => o.id === qr.id)!;
  for (const ticket of qrProjection.tickets)
    await actions.perform(
      "qr-serve-" + ticket.station,
      "waiter",
      { ticketId: ticket.id },
      { orderId: qr.id },
      true,
      async () => {
        const current = (
          await manager.request<SimplePilotOrder[]>(
            "GET",
            "/v1/staff/pilot/orders?view=TODAY",
          )
        )
          .find((o) => o.id === qr.id)!
          .tickets.find((t) => t.id === ticket.id)!;
        if (current.status !== "SERVED")
          await waiter.request(
            "PATCH",
            `/v1/staff/production-tickets/${ticket.id}/status`,
            { status: "SERVED", expectedVersion: current.version },
          );
        return { id: ticket.id };
      },
    );
  await actions.perform(
    "payment-qr",
    "waiter",
    { sessionId: guest.sessionId, amount: onlineExpected },
    {
      kind: "PAYMENT",
      tableSessionId: guest.sessionId,
      amountMinor: onlineExpected,
      method: "CASH",
      allocation: "SESSION_ONLY_NO_RECEIPT",
    },
    true,
    (key) =>
      waiter.request(
        "POST",
        `/v1/staff/table-sessions/${guest.sessionId}/payments`,
        {
          amountMinor: onlineExpected,
          method: "CASH",
          idempotencyKey: key,
          externalReference: "TEST ONLY SESSION CASH",
        },
      ),
  );
  await call(
    "qr-session-close",
    "waiter",
    `/v1/staff/table-sessions/${guest.sessionId}/close`,
    {},
    false,
    "PATCH",
  );
  await call(
    "register-close",
    "manager",
    `/v1/staff/register/${cashSession.id}/close`,
    {
      countedCashMinor: openingCashMinor + recipes[0]!.expected,
      closingNote: "TEST ONLY independent expected cash",
    },
    false,
  );
  for (const actor of actors) {
    for (const [index, kind] of [
      "BREAK_START",
      "BREAK_END",
      "CLOCK_OUT",
    ].entries())
      await actions.perform(
        "clock-" + kind + "-" + actor,
        actor,
        { kind },
        {},
        true,
        (key) =>
          clients[actor]!.request(
            "POST",
            "/v1/staff/workforce/attendance/punch",
            {
              kind,
              expectedVersion: index + 1,
              idempotencyKey: key,
              ...(kind === "BREAK_START" ? { breakKind: "UNPAID" } : {}),
            },
          ),
      );
    await call(
      "shift-close-" + actor,
      actor,
      "/v1/staff/shift/end",
      { note: "TEST ONLY end operational shift" },
      false,
    );
  }
  const platform = await manager.request<DailyOperationsReport>(
    "GET",
    `/v1/staff/reports/daily?date=${date}`,
  );
  const report = await reconcile(run, platform);
  if (!report.discrepancies.length)
    assertLabCompletion(run.status, report.unresolvedActions, 0);
  await assertLabScope(run.tenantId, run.venueId);
  await prisma.$executeRaw`UPDATE operations_lab.run SET status=${report.discrepancies.length ? "NEEDS_REVIEW" : "COMPLETED"},checkpoint=${JSON.stringify({ report: report.filename, receiptIds: receipts.map((r) => r.id) })}::jsonb,updated_at=now() WHERE id=${run.id} AND tenant_id=${run.tenantId} AND venue_id=${run.venueId}`;
  console.log(
    JSON.stringify({
      profile,
      counts: report.counts,
      totals: report.totals,
      discrepancies: report.discrepancies,
      report: report.filename,
    }),
  );
  if (report.discrepancies.length)
    throw new Error("LAB_RECONCILIATION_DISCREPANCY");
}
await assertLabInstance();
await assertLabApi();
await mkdir("artifacts/operations-lab", { recursive: true });
try {
  // Serializes lab operators/runners across processes; no shared-actor races.
  await prisma.$transaction(
    async (tx) => {
      const locks = await tx.$queryRaw<
        Array<{ locked: boolean }>
      >`SELECT pg_try_advisory_xact_lock(292901) AS locked`;
      if (!locks[0]?.locked) throw new Error("LAB_RUNNER_ALREADY_ACTIVE");
      for (const profile of ["DE", "AL"] as const) {
        console.log("LAB1 " + profile + " operational day");
        await day(profile);
      }
    },
    { timeout: 600000 },
  );
} catch (error) {
  console.error(
    error instanceof LabHttpError ? error.message : (error as Error).message,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
