import { prisma } from "@flowgastronomie/database";
import {
  type LabRun,
  type LabIntent,
  type SimplePilotOrder,
  type FinalReceipt,
} from "@flowgastronomie/domain";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Actions } from "./actions.js";
import { LabClient, LabHttpError } from "./client.js";
import { roles, type provision } from "./provision.js";
import { assertLabScope } from "./guard.js";
export type VenueContext = Awaited<ReturnType<typeof provision>>;
export class LabOperations {
  actions: Actions;
  manager: LabClient;
  deviceId = "";
  cashSessionId = "";
  openingCashMinor: number;
  afterPayment?: (receipt: FinalReceipt) => void;
  constructor(
    readonly context: VenueContext,
    readonly run: LabRun,
  ) {
    this.manager = context.clients.manager!;
    this.actions = new Actions(
      run,
      Object.fromEntries(
        Object.entries(context.state.actors)
          .filter(([, a]) => a.staff)
          .map(([key, a]) => [
            key,
            {
              membershipId: a.staff!.membershipId,
              sessionId: a.staff!.sessionId,
            },
          ]),
      ),
    );
    this.openingCashMinor = context.state.actors.owner!.staff!.email.includes(
      ".de@",
    )
      ? 10000
      : 1000000;
  }
  scope() {
    return { tenantId: this.run.tenantId, venueId: this.run.venueId };
  }
  async call<T = Record<string, unknown>>(
    name: string,
    actor: string,
    method: string,
    path: string,
    body: unknown,
    expected: Record<string, unknown> = {},
    execute?: (key: string) => Promise<T>,
  ) {
    return this.actions.perform<T>(
      name,
      actor,
      { method, path, body },
      expected,
      true,
      execute ??
        ((key) =>
          this.context.clients[actor]!.request<T>(method, path, body, {
            "idempotency-key": key,
          })),
    );
  }
  async begin() {
    const marker = "TEST ONLY LAB " + this.run.id;
    for (const actor of Object.keys(roles)) {
      const identity = this.context.state.actors[actor]!.staff!;
      const shift = await this.call<{ id: string }>(
        "shift-open-" + actor,
        actor,
        "POST",
        "/v1/staff/shift/start",
        { note: marker },
        { kind: "SHIFT" },
        async () => {
          const existing = await prisma.staffShift.findFirst({
            where: {
              ...this.scope(),
              membershipId: identity.membershipId,
              status: "OPEN",
            },
          });
          if (existing) {
            if (existing.openingNote !== marker)
              throw new Error("LAB_EXTERNAL_SHIFT_REQUIRES_REVIEW");
            return { id: existing.id };
          }
          return this.context.clients[actor]!.request(
            "POST",
            "/v1/staff/shift/start",
            { note: marker },
          );
        },
      );
      await this.actions.perform(
        "clock-in-" + actor,
        actor,
        { kind: "CLOCK_IN", shiftId: shift.id },
        { kind: "ATTENDANCE" },
        true,
        (key) =>
          this.context.clients[actor]!.request(
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
    const register = await this.call<{ id: string }>(
      "register-open",
      "manager",
      "POST",
      "/v1/staff/register/open",
      { openingCashMinor: this.openingCashMinor, openingNote: marker },
      { kind: "REGISTER" },
      async () => {
        const current = await this.manager.request<{
          session: { id: string; openingNote: string } | null;
        }>("GET", "/v1/staff/register");
        if (current.session) {
          if (current.session.openingNote !== marker)
            throw new Error("LAB_EXTERNAL_REGISTER_REQUIRES_REVIEW");
          return current.session;
        }
        return this.manager.request("POST", "/v1/staff/register/open", {
          openingCashMinor: this.openingCashMinor,
          openingNote: marker,
        });
      },
    );
    this.cashSessionId = register.id;
    const devices = await this.manager.request<{
      devices: Array<{ id: string; mode: string }>;
    }>("GET", "/v1/staff/hardware/devices");
    const paired =
      devices.devices.find((d) => d.mode === "SIMULATOR") ??
      (await this.call<{ id: string }>(
        "pair-simulator",
        "manager",
        "POST",
        "/v1/staff/hardware/pair",
        { mode: "SIMULATOR", displayName: "TEST ONLY PDF simulator" },
      ));
    this.deviceId = paired.id;
  }
  staffActor(intent: LabIntent) {
    return ["waiter", "waiter2", "cashier"][intent.position % 3]!;
  }
  name(intent: LabIntent, suffix: string) {
    return (
      "traffic-" + intent.position.toString().padStart(3, "0") + "-" + suffix
    );
  }
  async projection(id: string) {
    const rows = await this.manager.request<SimplePilotOrder[]>(
      "GET",
      "/v1/staff/pilot/orders?view=TODAY",
    );
    const row = rows.find((o) => o.id === id || o.reference === id);
    if (!row) throw new Error("LAB_SOURCE_ORDER_MISSING");
    return row;
  }
  async create(
    intent: LabIntent,
    browserCreate?: (key: string) => Promise<{ referenceCode: string }>,
  ) {
    const items = intent.items.map(
      ({ productId, quantity, variantId, modifierOptionIds, notes }) => ({
        productId,
        quantity,
        ...(variantId ? { variantId } : {}),
        ...(modifierOptionIds ? { modifierOptionIds } : {}),
        ...(notes ? { notes } : {}),
      }),
    );
    const expected = {
      kind: "ORDER",
      channel: intent.channel,
      provenance: intent.provenance,
      totalMinor: intent.totalMinor,
      currency: this.context.state.actors.owner!.staff!.email.includes(".de@")
        ? "EUR"
        : "ALL",
      items: intent.items,
      cancel: intent.cancel,
    };
    let result: { id?: string; referenceCode?: string };
    if (intent.channel === "WEBSITE") {
      result = await this.actions.perform(
        this.name(intent, "create"),
        "guest",
        { items, channel: intent.channel, provenance: intent.provenance },
        expected,
        intent.provenance !== "WEBSITE_BROWSER",
        browserCreate ??
          (async (key) => {
            const response = await new LabClient(
              this.context.state.actors.owner!.staff!.email.includes(".de@")
                ? "DE"
                : "AL",
            ).request<{ referenceCode: string }>(
              "POST",
              "/v1/public/online-orders/" + this.context.publicSlug,
              {
                locale: "en",
                fulfillmentType: "PICKUP",
                timingMode: "ASAP",
                contact: {
                  name: "TEST ONLY Customer " + intent.position,
                  phone: "0000000000",
                  email: "guest" + intent.position + "@operations-lab.invalid",
                },
                items,
                idempotencyKey: key,
              },
            );
            return { referenceCode: response.referenceCode };
          }),
      );
    } else if (intent.channel === "QR") {
      const tables = this.context.state.tables!.slice(
          Math.ceil(this.context.state.tables!.length / 2),
        ),
        table = tables[intent.position % tables.length]!;
      const vault =
        ".operations-lab/guest-" +
        this.run.id +
        "-" +
        intent.position +
        ".json";
      let guest: { sessionId: string; guestToken: string };
      try {
        guest = JSON.parse(await readFile(vault, "utf8"));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        guest = await new LabClient().request(
          "POST",
          `/v1/public/tables/${table.qrToken}/sessions`,
        );
        await writeFile(vault, JSON.stringify(guest), { mode: 0o600 });
      }
      result = await this.actions.perform(
        this.name(intent, "create"),
        "guest",
        { items, tableId: table.id },
        expected,
        true,
        (key) =>
          new LabClient().request<{ id: string }>(
            "POST",
            `/v1/public/sessions/${guest.sessionId}/orders`,
            { locale: "en", items },
            { "x-guest-token": guest.guestToken, "idempotency-key": key },
          ),
      );
    } else {
      const tables = this.context.state.tables!.slice(
        0,
        Math.ceil(this.context.state.tables!.length / 2),
      );
      let table = tables[0]!;
      if (intent.channel === "STAFF_TABLE") {
        const prior = await prisma.$queryRaw<
          Array<{ expected: { tableId?: string } }>
        >`SELECT expected FROM operations_lab.action WHERE event_id=${this.actions.key(this.name(intent, "create"))} AND tenant_id=${this.run.tenantId} AND venue_id=${this.run.venueId}`;
        if (prior[0]?.expected.tableId)
          table = tables.find((t) => t.id === prior[0]!.expected.tableId)!;
        else {
          const occupied = await prisma.tableSession.findMany({
            where: {
              ...this.scope(),
              status: "OPEN",
              tableId: { in: tables.map((t) => t.id) },
            },
            select: { tableId: true },
          });
          const available = tables.find(
            (t) => !occupied.some((s) => s.tableId === t.id),
          );
          if (!available) throw new Error("LAB_TABLE_CAPACITY_WAIT");
          table = available;
        }
        Object.assign(expected, { tableId: table.id });
      }
      result = await this.call<{ id: string }>(
        this.name(intent, "create"),
        this.staffActor(intent),
        "POST",
        "/v1/staff/orders",
        {
          locale: "en",
          orderType: intent.channel === "COUNTER" ? "TAKEAWAY" : "DINE_IN",
          ...(intent.channel === "STAFF_TABLE" ? { tableId: table.id } : {}),
          items,
        },
        expected,
      );
    }
    const order = await this.projection(result.id ?? result.referenceCode!);
    if (order.totalMinor !== intent.totalMinor)
      throw new Error("LAB_BASKET_PRICE_CONFLICT");
    return order.id;
  }
  async confirm(intent: LabIntent, id: string) {
    return this.actions.perform(
      this.name(intent, "confirm"),
      "manager",
      { id, cancel: intent.cancel },
      { orderId: id },
      true,
      async () => {
        const row = await this.projection(id);
        if (intent.cancel) {
          if (row.lifecycleStatus !== "CANCELLED") {
            if (intent.channel === "WEBSITE")
              await this.manager.request(
                "PATCH",
                `/v1/staff/online-orders/${id}/status`,
                {
                  status: "CANCELLED",
                  note: "TEST ONLY controlled cancellation",
                },
              );
            else {
              const actual = await prisma.order.findFirstOrThrow({
                where: { ...this.scope(), id },
                select: { version: true },
              });
              await this.manager.request(
                "PATCH",
                `/v1/staff/orders/${id}/status`,
                { status: "CANCELLED", expectedVersion: actual.version },
              );
            }
          }
        } else if (
          intent.channel === "WEBSITE" &&
          row.lifecycleStatus === "PENDING_CONFIRMATION"
        ) {
          await this.manager.request(
            "PATCH",
            `/v1/staff/online-orders/${id}/status`,
            { status: "ACCEPTED", note: "TEST ONLY" },
          );
        } else if (intent.channel === "QR" && row.lifecycleStatus === "NEW") {
          const actual = await prisma.order.findFirstOrThrow({
            where: { ...this.scope(), id },
            select: { version: true },
          });
          await this.manager.request("PATCH", `/v1/staff/orders/${id}/status`, {
            status: "ACCEPTED",
            expectedVersion: actual.version,
          });
        }
        return { id };
      },
    );
  }
  async advance(
    intent: LabIntent,
    id: string,
    station: string,
    status: "PREPARING" | "READY",
    actor?: string,
  ) {
    const lane =
      actor ??
      (station === "BAR" ? ["bar", "bar2"] : ["kitchen", "kitchen2"])[
        intent.position % 2
      ]!;
    return this.actions.perform(
      this.name(intent, station + "-" + status),
      lane,
      { id, station, status },
      { orderId: id },
      true,
      async () => {
        const row = await this.projection(id),
          ticket = row.tickets.find((t) => t.station === station);
        if (!ticket) throw new Error("LAB_ROUTING_MISSING");
        if (
          ticket.status === status ||
          ticket.status === "SERVED" ||
          (status === "PREPARING" && ticket.status === "READY")
        )
          return { id: ticket.id, recovered: true };
        if (intent.channel === "WEBSITE") {
          const available = await this.context.clients[lane]!.request<
            Array<{ id: string }>
          >("GET", "/v1/staff/online-production/" + station);
          if (!available.some((t) => t.id === ticket.id))
            throw new Error("LAB_PICKUP_GATE_PENDING");
        }
        await this.context.clients[lane]!.request(
          "PATCH",
          `/v1/staff/${intent.channel === "WEBSITE" ? "online-production" : "production"}-tickets/${ticket.id}/status`,
          { status, expectedVersion: ticket.version },
        );
        return { id: ticket.id, status };
      },
    );
  }
  async settle(intent: LabIntent, id: string, fault = false) {
    const actor = this.staffActor(intent),
      row = await this.projection(id);
    if (intent.channel === "QR") {
      for (const ticket of row.tickets)
        await this.actions.perform(
          this.name(intent, "serve-" + ticket.station),
          actor,
          { id: ticket.id },
          { orderId: id },
          true,
          async () => {
            const t = (await this.projection(id)).tickets.find(
              (t) => t.id === ticket.id,
            )!;
            if (t.status !== "SERVED")
              await this.context.clients[actor]!.request(
                "PATCH",
                `/v1/staff/production-tickets/${t.id}/status`,
                { status: "SERVED", expectedVersion: t.version },
              );
            return { id: t.id };
          },
        );
      const source = await prisma.order.findFirstOrThrow({
        where: { ...this.scope(), id },
        select: { tableSessionId: true },
      });
      return this.actions.perform(
        this.name(intent, "payment"),
        actor,
        { id, amountMinor: intent.totalMinor, method: "CASH" },
        {
          kind: "PAYMENT",
          orderId: id,
          tableSessionId: source.tableSessionId,
          amountMinor: intent.totalMinor,
          method: "CASH",
          allocation: "SESSION_ONLY_NO_RECEIPT",
        },
        true,
        (key) =>
          this.context.clients[actor]!.request(
            "POST",
            `/v1/staff/table-sessions/${source.tableSessionId}/payments`,
            {
              amountMinor: intent.totalMinor,
              method: "CASH",
              idempotencyKey: key,
              externalReference: "TEST ONLY " + this.run.id.slice(0, 12),
            },
          ),
      );
    }
    const body =
      intent.method === "CASH"
        ? { method: "CASH", receivedMinor: intent.totalMinor + 500 }
        : { method: "CARD_AT_COUNTER", terminalConfirmed: true };
    const receipt = await this.call<FinalReceipt>(
      this.name(intent, "payment"),
      actor,
      "POST",
      `/v1/staff/${intent.channel === "WEBSITE" ? "online-orders" : "pos/orders"}/${id}/payment`,
      body,
      {
        kind: "PAYMENT",
        ...(intent.channel === "WEBSITE"
          ? { onlineOrderId: id }
          : { orderId: id }),
        amountMinor: intent.totalMinor,
        method: intent.method,
        receivedMinor:
          intent.method === "CASH" ? intent.totalMinor + 500 : null,
        changeMinor: intent.method === "CASH" ? 500 : null,
      },
    );
    this.afterPayment?.(receipt);
    await this.actions.perform(
      this.name(intent, "handoff"),
      intent.channel === "WEBSITE" ? "manager" : actor,
      { id },
      { orderId: id },
      true,
      async () => {
        const current = await this.projection(id);
        if (intent.channel === "WEBSITE") {
          if (current.lifecycleStatus !== "COMPLETED")
            await this.manager.request(
              "PATCH",
              `/v1/staff/online-orders/${id}/status`,
              { status: "COMPLETED" },
            );
        } else if (current.lifecycleStatus !== "SERVED")
          await this.context.clients[actor]!.request(
            "POST",
            `/v1/staff/pos/orders/${id}/complete`,
          );
        return { id };
      },
    );
    const final = await this.context.clients[actor]!.request<FinalReceipt>(
      "GET",
      "/v1/staff/receipts/" + receipt.id,
    );
    await this.print(intent, final, fault);
    return final;
  }
  async print(intent: LabIntent, receipt: FinalReceipt, fault: boolean) {
    if (receipt.method === "CASH")
      await this.actions.perform(
        this.name(intent, "drawer"),
        "manager",
        { receiptId: receipt.id },
        { receiptId: receipt.id },
        true,
        (key) =>
          this.manager.request("POST", "/v1/staff/hardware/command", {
            deviceId: this.deviceId,
            kind: "openDrawer",
            receiptId: receipt.id,
            key,
          }),
      );
    const job = await this.actions.perform<{ id: string }>(
      this.name(intent, "print-queue"),
      "manager",
      { receiptId: receipt.id },
      { receiptId: receipt.id },
      true,
      (key) =>
        this.manager.request("POST", "/v1/staff/hardware/jobs", {
          receiptId: receipt.id,
          deviceId: this.deviceId,
          key,
        }),
    );
    if (fault)
      await this.actions.perform(
        this.name(intent, "paper-out"),
        "manager",
        { jobId: job.id },
        {},
        true,
        async () => {
          const jobs = await this.manager.request<
            Array<{ id: string; status: string; lastErrorCode: string }>
          >("GET", `/v1/staff/hardware/receipts/${receipt.id}/jobs`);
          const current = jobs.find((j) => j.id === job.id)!;
          if (current.status === "QUEUED") {
            await this.manager.request(
              "POST",
              `/v1/staff/hardware/simulator/${this.deviceId}/diagnostics`,
              { nextPrintFailure: "PAPER_OUT" },
            );
            const result = await this.manager.request<{
              job: { status: string; lastErrorCode: string };
            }>("POST", `/v1/staff/hardware/jobs/${job.id}/execute`, {
              retry: false,
            });
            if (
              result.job.status !== "FAILED" ||
              result.job.lastErrorCode !== "PAPER_OUT"
            )
              throw new Error("LAB_PAPER_OUT_MISSING");
          }
          return { id: job.id };
        },
      );
    await this.actions.perform(
      this.name(intent, "print"),
      "manager",
      { jobId: job.id },
      { receiptId: receipt.id },
      true,
      async () => {
        const current = (
          await this.manager.request<
            Array<{ id: string; status: string; lastErrorCode: string }>
          >("GET", `/v1/staff/hardware/receipts/${receipt.id}/jobs`)
        ).find((j) => j.id === job.id)!;
        if (current.lastErrorCode === "UNKNOWN_RESULT")
          throw new Error("LAB_PRINT_NEEDS_REVIEW");
        const result = await this.manager.request<{ job: { status: string } }>(
          "POST",
          `/v1/staff/hardware/jobs/${job.id}/execute`,
          { retry: current.status === "FAILED" },
        );
        if (result.job.status !== "PRINTED")
          throw new Error("LAB_PDF_OUTPUT_UNCONFIRMED");
        return { id: job.id, receiptId: receipt.id };
      },
    );
    if (fault) {
      const copy = await this.actions.perform<{ id: string }>(
        this.name(intent, "reprint-queue"),
        "manager",
        { receiptId: receipt.id },
        { receiptId: receipt.id },
        true,
        (key) =>
          this.manager.request("POST", "/v1/staff/hardware/jobs", {
            receiptId: receipt.id,
            deviceId: this.deviceId,
            key,
          }),
      );
      await this.call(
        this.name(intent, "reprint"),
        "manager",
        "POST",
        `/v1/staff/hardware/jobs/${copy.id}/execute`,
        { retry: false },
      );
    }
  }
  async closeTables() {
    const sources = await prisma.$queryRaw<
      Array<{ result: { id?: string } | null }>
    >`SELECT result FROM operations_lab.action WHERE run_id=${this.run.id} AND tenant_id=${this.run.tenantId} AND venue_id=${this.run.venueId} AND expected->>'kind'='ORDER'`;
    const ownedIds = sources.flatMap((s) =>
      s.result?.id ? [s.result.id] : [],
    );
    const sessions = await prisma.tableSession.findMany({
      where: {
        ...this.scope(),
        status: "OPEN",
        orders: { some: { id: { in: ownedIds } } },
      },
      include: { orders: { select: { id: true, status: true } } },
    });
    for (const session of sessions) {
      if (
        session.orders.some(
          (o) =>
            !ownedIds.includes(o.id) ||
            !["SERVED", "CANCELLED"].includes(o.status),
        )
      )
        continue;
      await this.call(
        "close-table-" + session.id,
        "manager",
        "PATCH",
        `/v1/staff/table-sessions/${session.id}/close`,
        {},
        { tableSessionId: session.id },
        async () => {
          const current = await prisma.tableSession.findFirstOrThrow({
            where: { ...this.scope(), id: session.id },
          });
          if (current.status !== "CLOSED")
            await this.manager.request(
              "PATCH",
              `/v1/staff/table-sessions/${session.id}/close`,
              {},
            );
          return { id: session.id };
        },
      );
    }
  }
  async end(intents: LabIntent[]) {
    await this.closeTables();
    const countedCashMinor =
      this.openingCashMinor +
      intents
        .filter((i) => !i.cancel && i.channel !== "QR" && i.method === "CASH")
        .reduce((n, i) => n + i.totalMinor, 0);
    await this.call(
      "register-close",
      "manager",
      "POST",
      `/v1/staff/register/${this.cashSessionId}/close`,
      { countedCashMinor, closingNote: "TEST ONLY authored scenario count" },
      { kind: "REGISTER_CLOSE" },
      async () => {
        const current = await prisma.cashSession.findFirstOrThrow({
          where: { ...this.scope(), id: this.cashSessionId },
        });
        if (current.status === "CLOSED") return { id: current.id };
        return this.manager.request(
          "POST",
          `/v1/staff/register/${this.cashSessionId}/close`,
          {
            countedCashMinor,
            closingNote: "TEST ONLY authored scenario count",
          },
        );
      },
    );
    for (const actor of Object.keys(roles)) {
      for (const [index, kind] of [
        "BREAK_START",
        "BREAK_END",
        "CLOCK_OUT",
      ].entries())
        await this.actions.perform(
          "clock-" + kind + "-" + actor,
          actor,
          { kind },
          { kind: "ATTENDANCE" },
          true,
          (key) =>
            this.context.clients[actor]!.request(
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
      await this.call(
        "shift-close-" + actor,
        actor,
        "POST",
        "/v1/staff/shift/end",
        { note: "TEST ONLY shift ended" },
        { kind: "SHIFT_CLOSE" },
        async () => {
          const current = await this.context.clients[actor]!.request<{
            shift: unknown;
          }>("GET", "/v1/staff/shift");
          if (!current.shift) return { closed: true };
          return this.context.clients[actor]!.request(
            "POST",
            "/v1/staff/shift/end",
            { note: "TEST ONLY shift ended" },
          );
        },
      );
    }
  }
}
