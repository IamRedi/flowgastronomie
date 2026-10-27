import { randomUUID } from "node:crypto";
import { snapshotTax } from "@flowgastronomie/domain";
import { afterEach, afterAll, describe, expect, it } from "vitest";
import { prisma } from "./client.js";
import { counterSaleRepository as sales } from "./counter-sale-repository.js";
import { staffOrderRepository } from "./staff-order-repository.js";
import {
  staffWorkRepository,
  type StaffActor,
} from "./staff-work-repository.js";
import { staffOperationsRepository } from "./staff-operations-repository.js";
import { pilotOperationsRepository as pilot } from "./pilot-operations-repository.js";
import { staffProductionRepository } from "./staff-production-repository.js";

const tenants: string[] = [];
async function fixture(existingTenant?: string) {
  const unique = randomUUID();
  const tenantId =
    existingTenant ??
    (await prisma.tenant.create({ data: { name: "P2 test", slug: unique } }))
      .id;
  if (!existingTenant) tenants.push(tenantId);
  const venue = await prisma.venue.create({
    data: {
      tenantId,
      name: "P2 test venue",
      slug: unique,
      defaultLocale: "EN",
    },
  });
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${unique}@example.test`,
      displayName: "Test cashier",
      passwordHash: "unused",
    },
  });
  const membership = await prisma.membership.create({
    data: { tenantId, venueId: venue.id, userId: user.id, role: "MANAGER" },
  });
  const shift = await prisma.staffShift.create({
    data: {
      tenantId,
      venueId: venue.id,
      userId: user.id,
      membershipId: membership.id,
      activeShiftKey: `${venue.id}:${user.id}`,
    },
  });
  const staff: StaffActor = {
    tenantId,
    venueId: venue.id,
    userId: user.id,
    membershipId: membership.id,
    role: "MANAGER",
  };
  await prisma.organizationBillingProfile.upsert({
    where: { tenantId },
    create: {
      tenantId,
      legalName: "Test Company",
      billingEmail: "billing@example.test",
      addressLine1: "Test Street 1",
      postalCode: "10000",
      city: "Test City",
      countryCode: "DE",
      vatId: "TEST_ONLY",
    },
    update: {},
  });
  const category = await prisma.menuCategory.create({
    data: { tenantId, venueId: venue.id, published: true },
  });
  const products = await Promise.all(
    [1100, 590].map((priceMinor, index) =>
      prisma.product.create({
        data: {
          tenantId,
          venueId: venue.id,
          categoryId: category.id,
          priceMinor,
          available: true,
          published: true,
          station: "KITCHEN",
          translations: {
            create: {
              tenantId,
              venueId: venue.id,
              locale: "EN",
              name: `Test item ${index}`,
            },
          },
        },
      }),
    ),
  );
  await sales.configureTax(staff, {
    code: "TEST_10",
    rateBasisPoints: 1000,
    productIds: [products[0]!.id],
  });
  await sales.configureTax(staff, {
    code: "TEST_18",
    rateBasisPoints: 1800,
    productIds: [products[1]!.id],
  });
  const order = (both = false) =>
    staffOrderRepository.createOrder({
      staff,
      orderType: "TAKEAWAY",
      locale: "en",
      idempotencyKey: randomUUID(),
      items: (both ? products : [products[0]!]).map((p) => ({
        productId: p.id,
        quantity: 1,
      })),
    });
  return { staff, products, order, shift };
}
const cash = (
  orderId: string,
  receivedMinor = 2000,
  idempotencyKey = randomUUID(),
) => ({ orderId, method: "CASH" as const, receivedMinor, idempotencyKey });
const card = (orderId: string) => ({
  orderId,
  method: "CARD_AT_COUNTER" as const,
  terminalConfirmed: true,
  idempotencyKey: randomUUID(),
});

describe.sequential("P2 cash sessions and receipts with PostgreSQL", () => {
  afterEach(async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL flowgastronomie.test_cleanup = 'on'`;
      const where = { tenantId: { in: tenants } };
      await tx.operationalOrderEvent.deleteMany({ where });
      await tx.receipt.deleteMany({ where });
      await tx.paymentRecord.deleteMany({ where });
      await tx.onlineOrder.deleteMany({ where });
      await tx.cashSession.deleteMany({ where });
      await tx.order.deleteMany({ where });
      await tx.staffShift.deleteMany({ where });
      await tx.product.updateMany({ where, data: { taxCategoryId: null } });
      await tx.tenant.deleteMany({ where: { id: { in: tenants } } });
    });
    tenants.length = 0;
  });
  afterAll(() => prisma.$disconnect());

  it("settles ready website pickup once, snapshots tax and isolates venues", async () => {
    const fixtureA = await fixture();
    const fixtureB = await fixture();
    const online = await prisma.onlineOrder.create({
      data: {
        tenantId: fixtureA.staff.tenantId,
        venueId: fixtureA.staff.venueId,
        idempotencyKey: randomUUID(),
        referenceCode: `RF-${randomUUID()}`,
        trackingTokenHash: randomUUID(),
        fulfillmentType: "PICKUP",
        status: "READY",
        totalMinor: 1100,
        contactName: "Guest",
        contactPhone: "test",
        requestedFor: new Date(),
        productionTickets: {
          create: {
            tenantId: fixtureA.staff.tenantId,
            venueId: fixtureA.staff.venueId,
            station: "KITCHEN",
            status: "READY",
          },
        },
        items: {
          create: {
            productId: fixtureA.products[0]!.id,
            productName: "Pizza",
            quantity: 1,
            unitPriceMinor: 1100,
            station: "KITCHEN",
            taxSnapshot: snapshotTax("TEST_10", 1000, 1100, 1),
          },
        },
      },
    });
    const input = {
      onlineOrderId: online.id,
      method: "CASH" as const,
      receivedMinor: 2000,
      idempotencyKey: randomUUID(),
    };
    await expect(sales.payOnline(fixtureA.staff, input)).rejects.toMatchObject({
      code: "REGISTER_REQUIRED",
    });
    await expect(sales.payOnline(fixtureB.staff, input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await sales.open(fixtureA.staff, 0);
    const contenders = await Promise.allSettled([
      sales.payOnline(fixtureA.staff, input),
      sales.payOnline(fixtureA.staff, input),
    ]);
    expect(
      contenders.filter((item) => item.status === "fulfilled"),
    ).toHaveLength(2);
    const receipt = await sales.payOnline(fixtureA.staff, input);
    expect(receipt).toMatchObject({
      onlineOrderId: online.id,
      orderId: null,
      grossMinor: 1100,
      netMinor: 1000,
    });
    expect((await sales.payOnline(fixtureA.staff, input)).id).toBe(receipt.id);
    await expect(
      sales.payOnline(fixtureA.staff, {
        ...input,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "ALREADY_PAID" });
    expect(
      await prisma.receipt.count({ where: { onlineOrderId: online.id } }),
    ).toBe(1);
    expect(
      await prisma.paymentRecord.count({ where: { onlineOrderId: online.id } }),
    ).toBe(1);
    expect(
      (await pilot.orders(fixtureA.staff)).find(
        (item) => item.id === online.id,
      ),
    ).toMatchObject({
      source: "WEBSITE",
      paymentStatus: "PAID",
      productionStatus: "READY",
    });
  });

  it("keeps unpaid and paid active orders until both production handoff and payment complete, scoped per venue", async () => {
    const f = await fixture();
    const other = await fixture(f.staff.tenantId);
    const identity = {
      ...f.staff,
      sessionId: "test",
      displayName: "Cashier",
      email: "cashier@example.test",
      tenantSlug: "test",
      venueSlug: "test",
      venueName: "Test",
    };
    const paid = await f.order();
    const unpaid = await f.order();
    expect((await pilot.counter(f.staff)).map((o) => o.paymentStatus)).toEqual([
      "UNPAID",
      "UNPAID",
    ]);
    expect(await pilot.counter(other.staff)).toEqual([]);
    await expect(pilot.complete(identity, unpaid.id)).rejects.toThrow(/ready/);
    await sales.open(f.staff, 0);
    const receipt = await sales.pay(f.staff, cash(paid.id));
    expect(
      (await pilot.counter(f.staff)).find((o) => o.id === paid.id),
    ).toMatchObject({
      paymentStatus: "PAID",
      productionStatus: "ACCEPTED",
      canComplete: false,
    });
    for (const order of [paid, unpaid]) {
      const ticket = await prisma.orderStationTicket.findFirstOrThrow({
        where: { orderId: order.id },
      });
      await staffProductionRepository.transition({
        staff: identity,
        ticketId: ticket.id,
        expectedVersion: ticket.version,
        status: "PREPARING",
      });
      await staffProductionRepository.transition({
        staff: identity,
        ticketId: ticket.id,
        expectedVersion: ticket.version + 1,
        status: "READY",
      });
      expect(
        (await pilot.counter(f.staff)).find((o) => o.id === order.id),
      ).toMatchObject({ productionStatus: "READY", canComplete: true });
      await pilot.complete(identity, order.id);
    }
    expect(
      (await pilot.counter(f.staff)).map((o) => ({
        id: o.id,
        status: o.productionStatus,
        paid: o.paymentStatus,
      })),
    ).toEqual([{ id: unpaid.id, status: "SERVED", paid: "UNPAID" }]);
    await sales.pay(f.staff, card(unpaid.id));
    expect(await pilot.counter(f.staff)).toEqual([]);
    expect(await sales.receipt(f.staff, receipt.id)).toMatchObject({
      id: receipt.id,
    });
  });

  it("opens one register, denies duplicate open, derives balance, closes and preserves closing snapshot", async () => {
    const f = await fixture();
    const session = await sales.open(f.staff, 10000, "Test float");
    await expect(
      prisma.cashSession.update({
        where: { id: session.id },
        data: { activeVenueKey: null },
      }),
    ).rejects.toThrow(/CashSession_open_key_required/);
    await expect(sales.open(f.staff, 0)).rejects.toMatchObject({
      code: "REGISTER_ALREADY_OPEN",
    });
    const order = await f.order();
    await sales.pay(f.staff, cash(order.id));
    await sales.pay(f.staff, card((await f.order()).id));
    expect((await sales.register(f.staff)).session?.expectedCashMinor).toBe(
      11100,
    );
    const closing = await sales.close(
      f.staff,
      session.id,
      11050,
      "Counted twice",
    );
    expect(closing).toMatchObject({
      status: "CLOSED",
      expectedCashMinor: 11100,
      countedCashMinor: 11050,
      differenceMinor: -50,
      openingNote: "Test float",
      closingNote: "Counted twice",
    });
    await expect(
      prisma.cashSession.update({
        where: { id: session.id },
        data: { countedCashMinor: 0 },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      prisma.cashSession.delete({ where: { id: session.id } }),
    ).rejects.toThrow(/immutable/);
    await expect(sales.close(f.staff, session.id, 0)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await sales.open(f.staff, 200);
    expect((await sales.register(f.staff)).history[0]?.expectedCashMinor).toBe(
      11100,
    );
    expect(
      await prisma.auditEvent.count({
        where: {
          tenantId: f.staff.tenantId,
          action: {
            in: [
              "REGISTER_OPENED",
              "REGISTER_CLOSED",
              "COUNTER_PAYMENT_RECORDED",
              "RECEIPT_FINALIZED",
            ],
          },
        },
      }),
    ).toBe(7);
  });

  it("requires open cash register, enough received cash and explicit independent card terminal confirmation", async () => {
    const f = await fixture();
    const order = await f.order();
    await expect(sales.pay(f.staff, cash(order.id))).rejects.toMatchObject({
      code: "REGISTER_REQUIRED",
    });
    await sales.open(f.staff, 0);
    await expect(
      sales.pay(f.staff, cash(order.id, 1099)),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CASH" });
    await expect(
      sales.pay(f.staff, { ...card(order.id), terminalConfirmed: false }),
    ).rejects.toMatchObject({ code: "TERMINAL_CONFIRMATION_REQUIRED" });
    expect(
      await prisma.paymentRecord.count({ where: { orderId: order.id } }),
    ).toBe(0);
    const receipt = await sales.pay(f.staff, cash(order.id));
    expect(receipt).toMatchObject({
      method: "CASH",
      receivedMinor: 2000,
      changeMinor: 900,
      grossMinor: 1100,
      netMinor: 1000,
      taxMinor: 100,
      status: "FINALIZED",
      number: "R-000001",
    });
  });

  it("records CARD without a cash session or cash balance mutation", async () => {
    const f = await fixture();
    const receipt = await sales.pay(f.staff, card((await f.order()).id));
    expect(receipt).toMatchObject({
      method: "CARD_AT_COUNTER",
      receivedMinor: null,
      changeMinor: null,
    });
    expect(
      (
        await prisma.paymentRecord.findUniqueOrThrow({
          where: { id: receipt.paymentId },
        })
      ).cashSessionId,
    ).toBeNull();
    expect((await sales.register(f.staff)).session).toBeNull();
  });

  it("returns one receipt for concurrent retries, denies reuse with different input and duplicate settlement", async () => {
    const f = await fixture();
    await sales.open(f.staff, 0);
    const order = await f.order();
    const request = cash(order.id);
    const receipts = await Promise.all([
      sales.pay(f.staff, request),
      sales.pay(f.staff, request),
      sales.pay(f.staff, request),
    ]);
    expect(new Set(receipts.map((r) => r.id)).size).toBe(1);
    expect(
      await prisma.paymentRecord.count({ where: { orderId: order.id } }),
    ).toBe(1);
    await expect(
      sales.pay(f.staff, { ...request, receivedMinor: 2100 }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(sales.pay(f.staff, cash(order.id))).rejects.toMatchObject({
      code: "ALREADY_PAID",
    });
  });

  it("generates sequential concurrency-safe numbers isolated per venue", async () => {
    const f = await fixture();
    const other = await fixture(f.staff.tenantId);
    const orders = await Promise.all([
      f.order(),
      f.order(),
      f.order(),
      f.order(),
    ]);
    const receipts = await Promise.all(
      orders.map((order) => sales.pay(f.staff, card(order.id))),
    );
    expect(receipts.map((r) => r.number).sort()).toEqual([
      "R-000001",
      "R-000002",
      "R-000003",
      "R-000004",
    ]);
    expect(
      (await sales.pay(other.staff, card((await other.order()).id))).number,
    ).toBe("R-000001");
    await expect(
      sales.receipt(other.staff, receipts[0]!.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("snapshots mixed tax, business, staff and items; later configuration never rewrites history", async () => {
    const f = await fixture();
    const order = await f.order(true);
    await sales.configureTax(f.staff, {
      code: "TEST_10",
      rateBasisPoints: 3000,
      productIds: [f.products[0]!.id],
    });
    const receipt = await sales.pay(f.staff, card(order.id));
    expect(receipt).toMatchObject({
      grossMinor: 1690,
      netMinor: 1500,
      taxMinor: 190,
      business: {
        legalName: "Test Company",
        vatId: "TEST_ONLY",
        venueId: f.staff.venueId,
      },
      cashier: {
        membershipId: f.staff.membershipId,
        displayName: "Test cashier",
      },
    });
    expect(receipt.breakdown).toHaveLength(2);
    expect(receipt.items[0]!.rateBasisPoints).toBe(1000);
    await prisma.organizationBillingProfile.update({
      where: { tenantId: f.staff.tenantId },
      data: { legalName: "New legal name" },
    });
    expect(await sales.receipt(f.staff, receipt.id)).toEqual(receipt);
    await expect(
      prisma.receipt.update({
        where: { id: receipt.id },
        data: { number: "Edited" },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      prisma.receipt.delete({ where: { id: receipt.id } }),
    ).rejects.toThrow(/immutable/);
    const item = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: order.id },
    });
    await expect(
      prisma.orderItem.update({
        where: { id: item.id },
        data: { taxSnapshot: { changed: true } },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      staffWorkRepository.voidPayment({
        staff: f.staff,
        paymentId: receipt.paymentId,
        reason: "Correction",
      }),
    ).rejects.toMatchObject({ code: "FINALIZED_PAYMENT" });
    await expect(
      staffOperationsRepository.transitionOrder({
        staff: f.staff,
        orderId: order.id,
        nextStatus: "CANCELLED",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "FINALIZED_PAYMENT" });
    const row = await prisma.receipt.findUniqueOrThrow({
      where: { id: receipt.id },
    });
    expect(row.fiscalTransactionId).toBeNull();
    expect(row.signature).toBeNull();
  });

  it("supports configured fulfillment context without rewriting older lines", async () => {
    const f = await fixture();
    await sales.configureTax(f.staff, {
      code: "TEST_10",
      rateBasisPoints: 1000,
      takeawayRateBasisPoints: 0,
      dineInRateBasisPoints: 2000,
      productIds: [f.products[0]!.id],
    });
    const receipt = await sales.pay(f.staff, card((await f.order()).id));
    expect(receipt.taxMinor).toBe(0);
    expect(receipt.items[0]!.taxCode).toBe("TEST_10");
    const table = await prisma.diningTable.create({
      data: {
        tenantId: f.staff.tenantId,
        venueId: f.staff.venueId,
        label: "P2 context test",
        qrTokenHash: randomUUID(),
      },
    });
    const dineIn = await staffOrderRepository.createOrder({
      staff: f.staff,
      idempotencyKey: randomUUID(),
      orderType: "DINE_IN",
      tableId: table.id,
      locale: "en",
      items: [{ productId: f.products[0]!.id, quantity: 1 }],
    });
    const dineReceipt = await sales.pay(f.staff, card(dineIn.id));
    expect(dineReceipt.items[0]!.rateBasisPoints).toBe(2000);
    expect(dineReceipt.netMinor + dineReceipt.taxMinor).toBe(
      dineReceipt.grossMinor,
    );
    expect(
      (await pilot.counter(f.staff)).find((o) => o.id === dineIn.id),
    ).toMatchObject({
      orderType: "DINE_IN",
      tableLabel: table.label,
      paymentStatus: "PAID",
      productionStatus: "ACCEPTED",
    });
    const identity = {
      ...f.staff,
      sessionId: "test",
      displayName: "Cashier",
      email: "cashier@example.test",
      tenantSlug: "test",
      venueSlug: "test",
      venueName: "Test",
    };
    const ticket = await prisma.orderStationTicket.findFirstOrThrow({
      where: { orderId: dineIn.id },
    });
    await staffProductionRepository.transition({
      staff: identity,
      ticketId: ticket.id,
      expectedVersion: 1,
      status: "PREPARING",
    });
    await staffProductionRepository.transition({
      staff: identity,
      ticketId: ticket.id,
      expectedVersion: 2,
      status: "READY",
    });
    await pilot.complete(identity, dineIn.id);
    const row = await prisma.order.findUniqueOrThrow({
      where: { id: dineIn.id },
      include: { tableSession: true },
    });
    expect(row.tableSession?.status).toBe("OPEN");
    expect((await pilot.counter(f.staff)).some((o) => o.id === dineIn.id)).toBe(
      false,
    );
    await staffOperationsRepository.closeTableSession({
      staff: f.staff,
      sessionId: row.tableSessionId!,
    });
    expect(
      (
        await prisma.tableSession.findUniqueOrThrow({
          where: { id: row.tableSessionId! },
        })
      ).status,
    ).toBe("CLOSED");
    expect((await pilot.counter(f.staff)).some((o) => o.id === dineIn.id)).toBe(
      false,
    );
  });

  it("does not accept cash that would overflow the register's integer balance", async () => {
    const f = await fixture();
    await sales.open(f.staff, 2_147_483_647);
    const order = await f.order();
    await expect(sales.pay(f.staff, cash(order.id))).rejects.toMatchObject({
      code: "INVALID_AMOUNT",
    });
    expect(
      await prisma.paymentRecord.count({
        where: { tenantId: f.staff.tenantId },
      }),
    ).toBe(0);
  });

  it("denies cross-tenant cash session, receipt, order payment and tax product assignment", async () => {
    const a = await fixture();
    const b = await fixture();
    const session = await sales.open(b.staff, 100);
    const order = await b.order();
    const receipt = await sales.pay(b.staff, card(order.id));
    expect((await sales.register(a.staff)).session).toBeNull();
    await expect(sales.close(a.staff, session.id, 100)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(sales.receipt(a.staff, receipt.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(sales.pay(a.staff, card(order.id))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      sales.configureTax(a.staff, {
        code: "BAD",
        rateBasisPoints: 0,
        productIds: [b.products[0]!.id],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("enforces permissions, active shift, tax readiness and real business profile", async () => {
    const f = await fixture();
    const order = await f.order();
    await expect(sales.open({ ...f.staff, role: "WAITER" }, 0)).rejects.toThrow(
      /permission/,
    );
    await expect(
      sales.pay({ ...f.staff, role: "KITCHEN" }, card(order.id)),
    ).rejects.toThrow(/permission/);
    await prisma.organizationBillingProfile.delete({
      where: { tenantId: f.staff.tenantId },
    });
    await expect(sales.pay(f.staff, card(order.id))).rejects.toMatchObject({
      code: "RECEIPT_BUSINESS_NOT_READY",
    });
    await prisma.organizationBillingProfile.create({
      data: {
        tenantId: f.staff.tenantId,
        legalName: "Test",
        billingEmail: "a@example.test",
        addressLine1: "Test",
        postalCode: "1",
        city: "Test",
        countryCode: "DE",
      },
    });
    await prisma.product.update({
      where: { id: f.products[0]!.id },
      data: { taxCategoryId: null },
    });
    await expect(
      sales.pay(f.staff, card((await f.order()).id)),
    ).rejects.toMatchObject({ code: "RECEIPT_TAX_NOT_READY" });
    await prisma.staffShift.update({
      where: { id: f.shift.id },
      data: { status: "CLOSED", activeShiftKey: null },
    });
    await expect(sales.open(f.staff, 0)).rejects.toThrow(/active staff shift/);
  });

  it("serializes concurrent register opens and close versus cash settlement", async () => {
    const f = await fixture();
    const opened = await Promise.allSettled([
      sales.open(f.staff, 100),
      sales.open(f.staff, 100),
    ]);
    expect(opened.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const session = (await sales.register(f.staff)).session!;
    const order = await f.order();
    const results = await Promise.allSettled([
      sales.pay(f.staff, cash(order.id)),
      sales.close(f.staff, session.id, 100),
    ]);
    const closed = await prisma.cashSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    const paymentSucceeded = results[0]!.status === "fulfilled";
    expect(closed.expectedCashMinor).toBe(paymentSucceeded ? 1200 : 100);
    expect(closed.status).toBe("CLOSED");
  });
});
