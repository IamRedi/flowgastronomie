import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "./client.js";
import { hardwareRepository as hardware } from "./hardware-repository.js";
import { counterSaleRepository as sales } from "./counter-sale-repository.js";
import { staffOrderRepository } from "./staff-order-repository.js";
import { type StaffActor } from "./staff-work-repository.js";
import { HardwareService } from "../../../apps/api/src/hardware-service.js";
const tenants: string[] = [];
async function fixture(existingTenant?: string) {
  const unique = randomUUID();
  const tenantId =
    existingTenant ??
    (await prisma.tenant.create({ data: { name: "P3 test", slug: unique } }))
      .id;
  if (!existingTenant) tenants.push(tenantId);
  const venue = await prisma.venue.create({
    data: {
      tenantId,
      name: "P3 test venue",
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

describe.sequential("P3 hardware bridge with PostgreSQL", () => {
  afterEach(async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL flowgastronomie.test_cleanup='on'`;
      const where = { tenantId: { in: tenants } };
      await tx.printJob.deleteMany({ where });
      await tx.hardwareCommandRecord.deleteMany({ where });
      await tx.hardwareDevice.deleteMany({ where });
      await tx.operationalOrderEvent.deleteMany({ where });
      await tx.receipt.deleteMany({ where });
      await tx.paymentRecord.deleteMany({ where });
      await tx.cashSession.deleteMany({ where });
      await tx.order.deleteMany({ where });
      await tx.staffShift.deleteMany({ where });
      await tx.product.updateMany({ where, data: { taxCategoryId: null } });
      await tx.tenant.deleteMany({ where: { id: { in: tenants } } });
    });
    tenants.length = 0;
  });
  afterAll(() => prisma.$disconnect());
  it("prints a finalized snapshot idempotently; reprint keeps the same receipt", async () => {
    const f = await fixture();
    const service = new HardwareService({ simulatorEnabled: true });
    const device = await service.pairSimulator(f.staff, "Counter test");
    const receipt = await sales.pay(f.staff, card((await f.order(true)).id));
    const jobs = await Promise.all(
      [1, 2, 3].map(() =>
        hardware.queue(f.staff, {
          receiptId: receipt.id,
          deviceId: device.id,
          key: "same-request",
        }),
      ),
    );
    expect(new Set(jobs.map((j) => j.id)).size).toBe(1);
    const results = await Promise.all(
      jobs.map((j) => service.executePrint(f.staff, j.id, false)),
    );
    expect(results.every((r) => r.job?.status === "PRINTED")).toBe(true);
    expect((await hardware.jobs(f.staff, receipt.id))[0]?.attempts).toBe(1);
    const records = await hardware.commands(f.staff, device.id);
    expect(records).toHaveLength(1);
    expect((records[0]!.payload as any).receipt).toMatchObject({
      id: receipt.id,
      number: receipt.number,
      grossMinor: receipt.grossMinor,
      taxMinor: receipt.taxMinor,
    });
    const another = await hardware.queue(f.staff, {
      receiptId: receipt.id,
      deviceId: device.id,
      key: "explicit-reprint",
    });
    await service.executePrint(f.staff, another.id, false);
    expect(
      await prisma.receipt.count({ where: { tenantId: f.staff.tenantId } }),
    ).toBe(1);
    expect(await hardware.jobs(f.staff, receipt.id)).toHaveLength(2);
    expect(
      (await service.diagnostics(f.staff, device.id, null)).operations.filter(
        (o) => o.action === "print",
      ),
    ).toHaveLength(2);
  });
  it("records FAILED, retains payment/receipt and retries to PRINTED", async () => {
    const f = await fixture();
    const service = new HardwareService({ simulatorEnabled: true });
    const device = await service.pairSimulator(f.staff, "Counter test");
    await sales.open(f.staff, 100);
    const receipt = await sales.pay(f.staff, cash((await f.order()).id));
    const original = await prisma.receipt.findUniqueOrThrow({
      where: { id: receipt.id },
    });
    await service.diagnostics(f.staff, device.id, "PAPER_OUT");
    const job = await hardware.queue(f.staff, {
      receiptId: receipt.id,
      deviceId: device.id,
      key: "paper-out-job",
    });
    expect(
      (await service.executePrint(f.staff, job.id, false)).job,
    ).toMatchObject({
      status: "FAILED",
      lastErrorCode: "PAPER_OUT",
      attempts: 1,
    });
    expect(
      await prisma.receipt.findUnique({ where: { id: receipt.id } }),
    ).toEqual(original);
    expect(
      await prisma.paymentRecord.count({
        where: { orderId: receipt.orderId, status: "RECORDED" },
      }),
    ).toBe(1);
    expect(
      (await service.executePrint(f.staff, job.id, true)).job,
    ).toMatchObject({ status: "PRINTED", attempts: 2 });
    expect(await hardware.jobs(f.staff, receipt.id)).toHaveLength(1);
  });
  it("opens drawer once for CASH and never for CARD; manual opening has permission and audit", async () => {
    const f = await fixture();
    const service = new HardwareService({ simulatorEnabled: true });
    const device = await service.pairSimulator(f.staff, "Counter test");
    await sales.open(f.staff, 0);
    const cashReceipt = await sales.pay(f.staff, cash((await f.order()).id));
    const cardReceipt = await sales.pay(f.staff, card((await f.order()).id));
    const command = {
      deviceId: device.id,
      kind: "openDrawer" as const,
      receiptId: cashReceipt.id,
      key: "drawer-request",
    };
    await Promise.all([
      service.executeCommand(f.staff, command),
      service.executeCommand(f.staff, { ...command, key: "ignored-new-key" }),
    ]);
    await expect(
      service.executeCommand(f.staff, {
        ...command,
        receiptId: cardReceipt.id,
      }),
    ).rejects.toMatchObject({ code: "DRAWER_CASH_ONLY" });
    await expect(
      service.executeCommand(
        { ...f.staff, role: "WAITER" },
        {
          deviceId: device.id,
          kind: "openDrawer",
          reason: "Test manual",
          key: randomUUID(),
        },
      ),
    ).rejects.toThrow(/permission/i);
    await service.executeCommand(f.staff, {
      deviceId: device.id,
      kind: "openDrawer",
      reason: "Authorized test",
      key: randomUUID(),
    });
    expect(
      (await service.diagnostics(f.staff, device.id, null)).operations.filter(
        (o) => o.action === "drawer",
      ),
    ).toHaveLength(2);
    expect(
      await prisma.auditEvent.count({
        where: { tenantId: f.staff.tenantId, action: "DRAWER_OPEN_REQUESTED" },
      }),
    ).toBe(2);
  });
  it("denies foreign tenant/venue receipt, job, device and pairing", async () => {
    const a = await fixture();
    const b = await fixture();
    const service = new HardwareService({ simulatorEnabled: true });
    const device = await service.pairSimulator(b.staff, "B");
    const receipt = await sales.pay(b.staff, card((await b.order()).id));
    const job = await hardware.queue(b.staff, {
      receiptId: receipt.id,
      deviceId: device.id,
      key: randomUUID(),
    });
    await expect(
      hardware.queue(a.staff, {
        receiptId: receipt.id,
        deviceId: device.id,
        key: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.executePrint(a.staff, job.id, false),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(hardware.jobs(a.staff, receipt.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      hardware.pair(a.staff, {
        displayName: "Other",
        mode: "SIMULATOR",
        fingerprint: device.fingerprint,
        publicKey: null,
        capabilities: device.capabilities as any,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.pairSimulator({ ...a.staff, role: "WAITER" }, "Waiter"),
    ).rejects.toThrow(/permission/i);
  });
  it("authenticates native pairing and signed result; forged results cannot mark PRINTED", async () => {
    const f = await fixture();
    const service = new HardwareService();
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyBase64 = keys.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64");
    const capabilities = {
      printerAvailable: true,
      paperWidth: 80,
      cutterAvailable: false,
      drawerAvailable: false,
      vendor: "TEST_ONLY",
      model: "Signed test device",
      bridgeVersion: "1.0.0",
    };
    const signed = (value: unknown) => {
      const bytes = Buffer.from(JSON.stringify(value));
      return {
        version: 1 as const,
        bodyBase64: bytes.toString("base64"),
        signatureBase64: sign("RSA-SHA256", bytes, keys.privateKey).toString(
          "base64",
        ),
      };
    };
    const proof = signed({
      version: 1,
      purpose: "PAIR",
      publicKeyBase64,
      nonce: randomUUID(),
      issuedAt: Date.now(),
      capabilities,
    });
    const device = await service.pairAndroid(f.staff, "Native test", proof);
    const receipt = await sales.pay(f.staff, card((await f.order()).id));
    const job = await hardware.queue(f.staff, {
      receiptId: receipt.id,
      deviceId: device.id,
      key: randomUUID(),
    });
    const dispatched = await service.executePrint(f.staff, job.id, false);
    expect(dispatched.envelope).not.toBeNull();
    expect(dispatched.job?.status).toBe("PRINTING");
    const payload = JSON.parse(
      Buffer.from(dispatched.envelope!.bodyBase64, "base64").toString("utf8"),
    );
    const outcome = {
      version: 1,
      commandId: payload.commandId,
      deviceId: device.id,
      success: true,
      errorCode: "OK",
      retryable: false,
      capabilities,
    };
    const wrong = signed(outcome);
    wrong.signatureBase64 = Buffer.alloc(256).toString("base64");
    await expect(service.completeNative(f.staff, wrong)).rejects.toMatchObject({
      code: "INVALID_SIGNATURE",
    });
    expect((await hardware.jobs(f.staff, receipt.id))[0]?.status).toBe(
      "PRINTING",
    );
    expect(
      (await service.completeNative(f.staff, signed(outcome))).job?.status,
    ).toBe("PRINTED");
    expect(
      (await service.completeNative(f.staff, signed(outcome))).job?.status,
    ).toBe("PRINTED");
    await expect(
      service.pairAndroid(
        f.staff,
        "Expired",
        signed({
          version: 1,
          purpose: "PAIR",
          publicKeyBase64,
          nonce: randomUUID(),
          issuedAt: Date.now() - 120000,
          capabilities,
        }),
      ),
    ).rejects.toMatchObject({ code: "PAIRING_EXPIRED" });
  });
  it("requires explicit duplicate-output confirmation for an expired in-flight print", async () => {
    const f = await fixture();
    const service = new HardwareService({ simulatorEnabled: true });
    const device = await service.pairSimulator(f.staff, "Counter");
    const receipt = await sales.pay(f.staff, card((await f.order()).id));
    const job = await hardware.queue(f.staff, {
      receiptId: receipt.id,
      deviceId: device.id,
      key: randomUUID(),
    });
    const pending = await hardware.beginPrint(f.staff, job.id, false);
    await prisma.hardwareCommandRecord.update({
      where: { id: pending.command!.commandId },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      hardware.beginPrint(f.staff, job.id, true),
    ).rejects.toMatchObject({ code: "UNKNOWN_RESULT" });
    expect(
      (await service.executePrint(f.staff, job.id, true, true)).job?.status,
    ).toBe("PRINTED");
  });
});
