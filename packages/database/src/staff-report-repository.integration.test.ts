import { randomUUID } from "node:crypto";

import { businessDateForInstant } from "@flowgastronomie/domain";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "./client.js";
import { onlineOrderRepository } from "./online-order-repository.js";
import { staffReportRepository } from "./staff-report-repository.js";
import { SubscriptionAccessDeniedError } from "./subscription-repository.js";
import type { StaffIdentity } from "./staff-auth-repository.js";
import { pilotOperationsRepository } from "./pilot-operations-repository.js";

const tenantIds = new Set<string>();
const openingHours = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
].map((day) => ({ day, closed: false, opensAt: "00:00", closesAt: "23:59" }));

async function createFixture() {
  const unique = randomUUID();
  const tenant = await prisma.tenant.create({
    data: { name: `Report ${unique}`, slug: `report-${unique}` },
  });
  tenantIds.add(tenant.id);
  const subscription = await prisma.subscription.create({
    data: {
      tenantId: tenant.id,
      plan: "RESTAURANT_PRO",
      status: "ACTIVE",
      currentPeriodStartedAt: new Date(Date.now() - 60_000),
      currentPeriodEndsAt: new Date(Date.now() + 86_400_000),
    },
  });
  await prisma.entitlement.createMany({
    data: ["PUBLIC_WEBSITE", "ONLINE_ORDERING", "REPORTING"].map(
      (featureKey) => ({
        tenantId: tenant.id,
        subscriptionId: subscription.id,
        featureKey,
        enabled: true,
      }),
    ),
  });
  const venue = await prisma.venue.create({
    data: {
      tenantId: tenant.id,
      name: "Report venue",
      slug: `report-venue-${unique}`,
      defaultLocale: "EN",
      timezone: "Europe/Berlin",
      currency: "EUR",
    },
  });
  const publicSlug = `report-public-${unique}`;
  await prisma.venueWebsite.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      publicSlug,
      status: "PUBLISHED",
      openingHours,
      publishedAt: new Date(),
    },
  });
  const category = await prisma.menuCategory.create({
    data: { tenantId: tenant.id, venueId: venue.id, published: true },
  });
  const product = await prisma.product.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      categoryId: category.id,
      priceMinor: 1_200,
      currency: "EUR",
      available: true,
      published: true,
      station: "KITCHEN",
      translations: {
        create: {
          tenantId: tenant.id,
          venueId: venue.id,
          locale: "EN",
          name: "Report dish",
        },
      },
    },
  });
  const ingredient = await prisma.ingredient.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      name: "Report ingredient",
      baseUnit: "GRAM",
    },
  });
  const supplier = await prisma.supplier.create({
    data: { tenantId: tenant.id, venueId: venue.id, name: "Report supplier" },
  });
  await prisma.supplierItemPrice.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      supplierId: supplier.id,
      ingredientId: ingredient.id,
      packQuantity: 500,
      unit: "GRAM",
      priceMinor: 500,
      currency: "EUR",
      effectiveFrom: new Date(Date.now() - 60_000),
    },
  });
  await prisma.recipe.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      productId: product.id,
      ingredients: {
        create: {
          tenantId: tenant.id,
          venueId: venue.id,
          ingredientId: ingredient.id,
          quantityBaseUnits: 100,
        },
      },
    },
  });
  await prisma.deliveryZone.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      name: "Report delivery zone",
      postalPrefixes: ["10"],
      feeMinor: 150,
      minimumOrderMinor: 0,
    },
  });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `${unique}@report.integration.test`,
      displayName: "Report owner",
      passwordHash: "not-used",
    },
  });
  const membership = await prisma.membership.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      userId: user.id,
      role: "OWNER",
    },
  });
  const staff: StaffIdentity = {
    sessionId: `report-${unique}`,
    userId: user.id,
    membershipId: membership.id,
    displayName: user.displayName,
    email: user.email,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    venueId: venue.id,
    venueName: venue.name,
    venueSlug: venue.slug,
    role: "OWNER",
  };
  return { product, publicSlug, staff, timezone: venue.timezone };
}

describe.sequential("staff report repository with PostgreSQL", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    await prisma.$connect();
  });

  afterEach(async () => {
    const ids = [...tenantIds];
    if (!ids.length) return;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL flowgastronomie.test_cleanup = 'on'`;
      await tx.receipt.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.paymentRecord.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.cashSession.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.order.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.tableSession.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.staffShift.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.operationalOrderEvent.deleteMany({
        where: { tenantId: { in: ids } },
      });
      await tx.onlineOrder.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.supplierItemPrice.deleteMany({
        where: { tenantId: { in: ids } },
      });
      await tx.recipe.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.ingredient.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.supplier.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.tenant.deleteMany({ where: { id: { in: ids } } });
    });
    tenantIds.clear();
  });

  afterAll(async () => prisma.$disconnect());

  const reportDate = "2026-10-05";
  const today = new Date("2026-10-05T10:00:00Z");
  const yesterday = new Date("2026-10-04T10:00:00Z");
  async function reconciliationFixture() {
    const fixture = await createFixture();
    const scope = {
      tenantId: fixture.staff.tenantId,
      venueId: fixture.staff.venueId,
    };
    const shift = await prisma.staffShift.create({
      data: {
        ...scope,
        userId: fixture.staff.userId,
        membershipId: fixture.staff.membershipId,
      },
    });
    const cashSession = await prisma.cashSession.create({
      data: {
        ...scope,
        openedByMembershipId: fixture.staff.membershipId,
        shiftId: shift.id,
        activeVenueKey: fixture.staff.venueId,
        openingCashMinor: 0,
      },
    });
    const order = (
      totalMinor: number,
      status: "ACCEPTED" | "SERVED" | "CANCELLED" = "ACCEPTED",
      createdAt = today,
      tableSessionId?: string,
    ) =>
      prisma.order.create({
        data: {
          ...scope,
          source: "STAFF_TABLET",
          idempotencyKey: randomUUID(),
          totalMinor,
          status,
          createdAt,
          tableSessionId: tableSessionId ?? null,
        },
      });
    const online = (
      totalMinor: number,
      status: "COMPLETED" | "REJECTED" | "CANCELLED" = "COMPLETED",
      createdAt = today,
    ) =>
      prisma.onlineOrder.create({
        data: {
          ...scope,
          idempotencyKey: randomUUID(),
          referenceCode: randomUUID(),
          trackingTokenHash: randomUUID(),
          fulfillmentType: "PICKUP",
          status,
          totalMinor,
          createdAt,
          requestedFor: createdAt,
          contactName: "Test guest",
          contactPhone: "test-only",
        },
      });
    const payment = (
      amountMinor: number,
      method: "CASH" | "CARD_AT_COUNTER" | "CARD_AT_TABLE" | "OTHER",
      links: {
        orderId?: string;
        onlineOrderId?: string;
        tableSessionId?: string;
      } = {},
      recordedAt = today,
      status: "RECORDED" | "VOIDED" = "RECORDED",
    ) =>
      prisma.paymentRecord.create({
        data: {
          ...scope,
          ...links,
          amountMinor,
          currency: "EUR",
          method,
          recordedAt,
          status,
          ...(links.orderId || links.onlineOrderId
            ? { counterPaymentKey: randomUUID() }
            : {}),
          ...(method === "CASH" && (links.orderId || links.onlineOrderId)
            ? {
                receivedMinor: amountMinor,
                changeMinor: 0,
                cashSessionId: cashSession.id,
              }
            : {}),
          ...(status === "VOIDED"
            ? {
                voidedAt: today,
                voidedByUserId: fixture.staff.userId,
                voidedByMembershipId: fixture.staff.membershipId,
                voidedByShiftId: shift.id,
                voidReason: "Test void",
              }
            : {}),
          idempotencyKey: randomUUID(),
          recordedByUserId: fixture.staff.userId,
          recordedByMembershipId: fixture.staff.membershipId,
          recordedByShiftId: shift.id,
        },
      });
    const report = (date = reportDate) =>
      staffReportRepository.daily({ staff: fixture.staff, date });
    return { ...fixture, scope, order, online, payment, report };
  }

  it("reconciles two creation-day orders, a prior-day payment, and Active/Today/Paid/Completed using persisted relationships", async () => {
    const f = await reconciliationFixture();
    const paid = await f.order(1650, "SERVED");
    const pending = await f.order(1220);
    const older = await f.order(3100, "SERVED", yesterday);
    const paidRecord = await f.payment(1650, "CASH", { orderId: paid.id });
    await f.payment(3100, "CARD_AT_COUNTER", { orderId: older.id });
    const receipt = await prisma.receipt.create({
      data: {
        ...f.scope,
        orderId: paid.id,
        paymentId: paidRecord.id,
        number: "TEST-1",
        sequence: 1,
        snapshot: { fixture: true },
      },
    });
    expect((await f.report()).reconciliation).toEqual({
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
    expect((await f.report()).payments).toEqual({
      recordedMinor: 4750,
      voidedMinor: 0,
      cashMinor: 1650,
      cardMinor: 3100,
      otherMinor: 0,
    });
    expect(
      (await pilotOperationsRepository.orders(f.staff)).map((o) => o.id),
    ).toEqual([pending.id]);
    const todayOrders = await pilotOperationsRepository.orders(f.staff, {
      view: "TODAY",
      date: reportDate,
    });
    expect(todayOrders.map((o) => o.id).sort()).toEqual(
      [paid.id, pending.id].sort(),
    );
    expect(todayOrders.find((o) => o.id === paid.id)).toMatchObject({
      lifecycleStatus: "SERVED",
      productionStatus: "COMPLETED",
      paymentStatus: "PAID",
      paidMinor: 1650,
      paymentMethods: ["CASH"],
      receiptId: receipt.id,
      canPay: false,
      canProduce: false,
      canComplete: false,
    });
    for (const view of ["PAID", "COMPLETED"] as const)
      expect(
        (
          await pilotOperationsRepository.orders(f.staff, {
            view,
            date: reportDate,
          })
        ).map((o) => o.id),
      ).toEqual([paid.id]);
  });

  it("includes online payments, excludes cancelled/rejected value, and shows excluded/unlinked recordings explicitly", async () => {
    const f = await reconciliationFixture();
    const online = await f.online(1200);
    const cancelled = await f.order(500, "CANCELLED");
    const rejected = await f.online(700, "REJECTED");
    await f.payment(1200, "CARD_AT_COUNTER", { onlineOrderId: online.id });
    await f.payment(500, "CASH", { orderId: cancelled.id });
    await f.payment(700, "CARD_AT_TABLE", { onlineOrderId: rejected.id });
    await f.payment(300, "OTHER");
    const report = await f.report();
    expect(report.reconciliation).toEqual({
      ordersCreated: {
        count: 1,
        orderValueMinor: 1200,
        paidMinor: 1200,
        pendingMinor: 0,
        unallocatedMinor: 0,
        overpaidMinor: 0,
        excludedCount: 2,
      },
      paymentsRecorded: {
        totalMinor: 2700,
        cashMinor: 500,
        cardMinor: 1900,
        otherMinor: 300,
        todayOrdersMinor: 1200,
        otherPaymentsMinor: 1500,
        earlierOrdersMinor: 0,
        tableSessionOnlyMinor: 0,
        excludedOrdersMinor: 1200,
        unlinkedMinor: 300,
      },
    });
    expect(
      await pilotOperationsRepository.orders(f.staff, {
        view: "TODAY",
        date: reportDate,
      }),
    ).toHaveLength(3);
    expect(
      (
        await pilotOperationsRepository.orders(f.staff, {
          view: "PAID",
          date: reportDate,
        })
      ).find((o) => o.id === online.id),
    ).toMatchObject({
      source: "WEBSITE",
      paymentStatus: "PAID",
      paidMinor: 1200,
      paymentMethods: ["CARD_AT_COUNTER"],
    });
  });

  it("uses the Berlin boundary and DST day rather than UTC calendar dates", async () => {
    const f = await reconciliationFixture();
    await f.order(100, "ACCEPTED", new Date("2026-10-04T21:59:59.999Z"));
    const first = await f.order(
      200,
      "SERVED",
      new Date("2026-10-04T22:00:00.000Z"),
    );
    const last = await f.order(
      300,
      "SERVED",
      new Date("2026-10-05T21:59:59.999Z"),
    );
    const next = await f.order(
      400,
      "ACCEPTED",
      new Date("2026-10-05T22:00:00.000Z"),
    );
    await f.payment(
      200,
      "CASH",
      { orderId: first.id },
      new Date("2026-10-04T22:00:00.000Z"),
    );
    await f.payment(
      300,
      "CARD_AT_COUNTER",
      { orderId: last.id },
      new Date("2026-10-05T21:59:59.999Z"),
    );
    await f.payment(
      400,
      "CARD_AT_COUNTER",
      { orderId: next.id },
      new Date("2026-10-05T22:00:00.000Z"),
    );
    expect((await f.report()).reconciliation).toMatchObject({
      ordersCreated: {
        count: 2,
        orderValueMinor: 500,
        paidMinor: 500,
        pendingMinor: 0,
      },
      paymentsRecorded: {
        totalMinor: 500,
        cashMinor: 200,
        cardMinor: 300,
        otherMinor: 0,
      },
    });
    expect(
      (
        await pilotOperationsRepository.orders(f.staff, {
          view: "TODAY",
          date: reportDate,
        })
      ).map((o) => o.id),
    ).toEqual([first.id, last.id]);
    await f.order(600, "ACCEPTED", new Date("2026-03-29T21:59:59.999Z"));
    await f.order(700, "ACCEPTED", new Date("2026-03-29T22:00:00.000Z"));
    expect(
      (await f.report("2026-03-29")).reconciliation?.ordersCreated,
    ).toMatchObject({ count: 1, orderValueMinor: 600, pendingMinor: 600 });
  });

  it("counts current direct payments from another date but excludes voids and protects venue/self scope", async () => {
    const f = await reconciliationFixture();
    const paid = await f.order(800, "SERVED");
    const voided = await f.order(900, "SERVED");
    await f.payment(
      800,
      "CASH",
      { orderId: paid.id },
      new Date("2026-10-06T10:00:00Z"),
    );
    await f.payment(900, "CASH", { orderId: voided.id }, today, "VOIDED");
    const other = await reconciliationFixture();
    const otherOrder = await other.order(9999);
    await other.payment(9999, "CASH", { orderId: otherOrder.id });
    const otherVenue = await prisma.venue.create({
      data: {
        tenantId: f.staff.tenantId,
        name: "Other venue",
        slug: randomUUID(),
      },
    });
    await prisma.order.create({
      data: {
        tenantId: f.staff.tenantId,
        venueId: otherVenue.id,
        totalMinor: 8888,
        source: "STAFF_TABLET",
        idempotencyKey: randomUUID(),
        createdAt: today,
      },
    });
    expect((await f.report()).reconciliation).toMatchObject({
      ordersCreated: {
        count: 2,
        orderValueMinor: 1700,
        paidMinor: 800,
        pendingMinor: 900,
      },
      paymentsRecorded: { totalMinor: 0 },
    });
    expect(
      (
        await pilotOperationsRepository.orders(f.staff, {
          view: "PAID",
          date: reportDate,
        })
      ).map((o) => o.id),
    ).toEqual([paid.id]);
    expect(
      (
        await staffReportRepository.daily({
          staff: { ...f.staff, role: "WAITER" },
          date: reportDate,
        })
      ).reconciliation,
    ).toBeNull();
  });

  it("keeps real session payments separate without assigning them to a created-today order", async () => {
    const f = await reconciliationFixture();
    const area = await prisma.area.create({
      data: { ...f.scope, name: "Test area" },
    });
    const table = await prisma.diningTable.create({
      data: {
        ...f.scope,
        areaId: area.id,
        label: "Test table",
        qrTokenHash: randomUUID(),
      },
    });
    const session = await prisma.tableSession.create({
      data: { ...f.scope, tableId: table.id },
    });
    const order = await f.order(1000, "SERVED", today, session.id);
    await f.payment(1000, "CASH", { tableSessionId: session.id });
    expect((await f.report()).reconciliation).toMatchObject({
      ordersCreated: {
        count: 1,
        orderValueMinor: 1000,
        paidMinor: 0,
        pendingMinor: 0,
        unallocatedMinor: 1000,
      },
      paymentsRecorded: {
        totalMinor: 1000,
        todayOrdersMinor: 0,
        tableSessionOnlyMinor: 1000,
      },
    });
    expect(
      (
        await pilotOperationsRepository.orders(f.staff, {
          view: "TODAY",
          date: reportDate,
        })
      ).find((o) => o.id === order.id),
    ).toMatchObject({
      paymentStatus: "PAID",
      paidMinor: 0,
      sessionPaymentMinor: 1000,
      canPay: false,
    });
  });

  it("reconciles daily channel totals with source orders and projects current recipe cost", async () => {
    const fixture = await createFixture();
    const input = (fulfillmentType: "PICKUP" | "DELIVERY" | "CATERING") => ({
      publicSlug: fixture.publicSlug,
      locale: "en" as const,
      idempotencyKey: randomUUID(),
      fulfillmentType,
      contact: { name: "Report guest", phone: "+49 30 123456" },
      requestedFor: new Date(Date.now() + 7_200_000),
      ...(fulfillmentType === "DELIVERY"
        ? {
            deliveryAddress: {
              line1: "Reportstraße 1",
              postalCode: "10115",
              city: "Berlin",
            },
          }
        : {}),
      ...(fulfillmentType === "CATERING" ? { cateringGuestCount: 8 } : {}),
      items: [{ productId: fixture.product.id, quantity: 1 }],
    });
    await onlineOrderRepository.submit(input("PICKUP"));
    await onlineOrderRepository.submit(input("DELIVERY"));
    await onlineOrderRepository.submit(input("CATERING"));

    const date = businessDateForInstant(new Date(), fixture.timezone);
    const report = await staffReportRepository.daily({
      staff: fixture.staff,
      date,
    });
    const sourceOrders = await prisma.onlineOrder.findMany({
      where: {
        tenantId: fixture.staff.tenantId,
        venueId: fixture.staff.venueId,
        createdAt: {
          gte: new Date(report.range.startsAt),
          lt: new Date(report.range.endsAt),
        },
      },
      select: { fulfillmentType: true, totalMinor: true },
    });

    expect(sourceOrders).toHaveLength(3);
    expect(report.channels).toEqual({
      table: { submitted: 0, orderValueMinor: 0 },
      pickup: { submitted: 1, orderValueMinor: 1_200 },
      delivery: { submitted: 1, orderValueMinor: 1_350 },
      catering: { submitted: 1, orderValueMinor: 1_200 },
    });
    expect(
      Object.values(report.channels).reduce(
        (total, channel) => total + channel.orderValueMinor,
        0,
      ),
    ).toBe(sourceOrders.reduce((total, order) => total + order.totalMinor, 0));
    expect(report.costing).toEqual({
      complete: true,
      itemCount: 3,
      costedItemCount: 3,
      estimatedOrderValueMinor: 3_600,
      estimatedDirectCostMinor: 300,
      estimatedFoodCostBasisPoints: 833,
      estimatedContributionMinor: 3_300,
      missingRecipeProductIds: [],
      missingPriceIngredientIds: [],
    });
  });

  it("denies reporting after its entitlement is disabled", async () => {
    const fixture = await createFixture();
    await prisma.entitlement.updateMany({
      where: { tenantId: fixture.staff.tenantId, featureKey: "REPORTING" },
      data: { enabled: false },
    });

    await expect(
      staffReportRepository.daily({
        staff: fixture.staff,
        date: businessDateForInstant(new Date(), fixture.timezone),
      }),
    ).rejects.toBeInstanceOf(SubscriptionAccessDeniedError);
  });
});
