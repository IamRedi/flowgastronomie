import {
  randomUUID,
  generateKeyPairSync,
  sign,
  verify,
  createPublicKey,
} from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  allowsAutomaticDrawer,
  assertPrintRetry,
  printerPayload,
  hardwareResult,
  type FinalReceipt,
  type HardwareCommand,
} from "@flowgastronomie/domain";
import { GeonNb11Adapter, SimulatorAdapter } from "./hardware-adapters.js";
import {
  HardwareService,
  resultSchema,
  verifyDeviceBody,
} from "./hardware-service.js";
import { registerHardwareRoutes } from "./hardware-routes.js";
const receipt: FinalReceipt = {
  id: "receipt",
  number: "R-000001",
  orderId: "order",
  paymentId: "payment",
  issuedAt: "2026-10-04T00:00:00.000Z",
  finalizedAt: "2026-10-04T00:00:00.000Z",
  status: "FINALIZED",
  currency: "EUR",
  grossMinor: 1100,
  netMinor: 1000,
  taxMinor: 100,
  method: "CASH",
  receivedMinor: 2000,
  changeMinor: 900,
  business: {
    legalName: "TEST — Ä Ö Ü ë ç €",
    addressLine1: "Test Street",
    postalCode: "00000",
    city: "TEST",
    countryCode: "DE",
    vatId: null,
    venueId: "venue",
    venueName: "Test venue",
  },
  cashier: { membershipId: "member", displayName: "Test" },
  items: [
    {
      taxCode: "TEST_10",
      rateBasisPoints: 1000,
      quantity: 1,
      grossUnitMinor: 1100,
      grossMinor: 1100,
      netMinor: 1000,
      taxMinor: 100,
      productId: "product",
      productName: "Ä Ö Ü ë ç €\u001b@",
      variantName: null,
      modifiers: [],
    },
  ],
  breakdown: [
    {
      taxCode: "TEST_10",
      rateBasisPoints: 1000,
      grossMinor: 1100,
      netMinor: 1000,
      taxMinor: 100,
    },
  ],
};
const command = (): HardwareCommand => ({
  version: 1,
  commandId: randomUUID(),
  deviceId: "device",
  deviceFingerprint: "fingerprint",
  tenantId: "tenant",
  venueId: "venue",
  expiresAt: Date.now() + 60000,
  command: "printReceipt",
  receipt: printerPayload(receipt),
});
describe("hardware contract and adapters", () => {
  it("maps finalized snapshots without recalculating money or losing Unicode", () => {
    const payload = printerPayload(receipt);
    expect(payload.items[0]!.productName).toBe("Ä Ö Ü ë ç € @");
    expect(payload.items[0]!.grossMinor).toBe(1100);
    expect(payload.breakdown).toEqual(receipt.breakdown);
    expect(payload.business.legalName).toBe(receipt.business.legalName);
    payload.items[0]!.grossMinor = 0;
    expect(receipt.items[0]!.grossMinor).toBe(1100);
  });
  it("draws only after finalized cash and requires FAILED for retry", () => {
    expect(allowsAutomaticDrawer(receipt)).toBe(true);
    expect(
      allowsAutomaticDrawer({ ...receipt, method: "CARD_AT_COUNTER" }),
    ).toBe(false);
    expect(() => assertPrintRetry("PRINTED")).toThrow();
    expect(() => assertPrintRetry("FAILED")).not.toThrow();
  });
  it("simulates 80mm, feed/cut and concurrent duplicate command suppression", async () => {
    const adapter = new SimulatorAdapter();
    const request = command();
    const results = await Promise.all(
      [1, 2, 3].map(() => adapter.execute(request)),
    );
    expect(results.every((result) => result.success)).toBe(true);
    expect(adapter.commands).toHaveLength(1);
    expect(adapter.operations.map((o) => o.action)).toEqual([
      "print",
      "feed",
      "cut",
    ]);
    const caps = await adapter.health();
    expect(caps.paperWidth).toBe(80);
  });
  it("normalizes paper errors and rejects arbitrary commands", async () => {
    const adapter = new SimulatorAdapter();
    adapter.nextPrintFailure = "PAPER_OUT";
    expect(await adapter.execute(command())).toMatchObject({
      success: false,
      errorCode: "PAPER_OUT",
      retryable: true,
    });
    await expect(
      adapter.execute({
        ...command(),
        command: "executeShell",
      } as unknown as HardwareCommand),
    ).rejects.toThrow(/Unsupported/);
    expect(() =>
      resultSchema.parse({
        ...hardwareResult(command(), adapter.capabilities, "OK"),
        success: false,
      }),
    ).toThrow();
  });
  it("preserves uncertain print results across duplicate command delivery", async () => {
    const adapter = new SimulatorAdapter();
    adapter.nextPrintFailure = "UNKNOWN_RESULT";
    const original = command();
    const result = await adapter.execute(original);
    expect(result).toMatchObject({
      success: false,
      errorCode: "UNKNOWN_RESULT",
    });
    expect(await adapter.execute(original)).toEqual(result);
    expect(adapter.commands).toHaveLength(1);
    expect(adapter.operations).toHaveLength(0);
  });
  it("does not advertise unverified GEON capabilities", async () => {
    const geon = new GeonNb11Adapter();
    expect(geon.capabilities.printerAvailable).toBe(false);
    expect(await geon.printTest()).toBe("PRINTER_UNAVAILABLE");
    expect(await geon.openDrawer()).toBe("DRAWER_UNAVAILABLE");
  });
  it("signs server commands and rejects forged device signatures", () => {
    const service = new HardwareService();
    const envelope = service.signCommand(command());
    const publicKey = createPublicKey({
      key: Buffer.from(service.publicSigningKey().publicKeyBase64, "base64"),
      format: "der",
      type: "spki",
    });
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(envelope.bodyBase64, "base64"),
        publicKey,
        Buffer.from(envelope.signatureBase64, "base64"),
      ),
    ).toBe(true);
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const bytes = Buffer.from(JSON.stringify({ version: 1 }));
    const key = keys.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64");
    expect(
      verifyDeviceBody(
        bytes.toString("base64"),
        sign("RSA-SHA256", bytes, keys.privateKey).toString("base64"),
        key,
      ),
    ).toEqual({ version: 1 });
    expect(() =>
      verifyDeviceBody(
        bytes.toString("base64"),
        Buffer.alloc(256).toString("base64"),
        key,
      ),
    ).toThrow(/invalid/i);
  });
  it("fails closed in production without persistent signer and disables simulator", () => {
    const service = new HardwareService({
      production: true,
      simulatorEnabled: true,
    });
    expect(service.simulatorEnabled).toBe(false);
    expect(() => service.publicSigningKey()).toThrow(/Configure/);
  });
});
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
describe("hardware transport", () => {
  it("requires staff auth", async () => {
    const app = Fastify();
    apps.push(app);
    registerHardwareRoutes(app, async (_req, reply) => {
      reply.code(401).send({ code: "AUTH_REQUIRED" });
      return null;
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/staff/hardware/command",
          payload: { kind: "execute", shell: "whoami" },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("rejects raw commands, arbitrary URLs and client supplied scopes", async () => {
    const app = Fastify();
    apps.push(app);
    registerHardwareRoutes(app, async () => ({
      sessionId: "session",
      userId: "user",
      membershipId: "member",
      displayName: "Test",
      email: "test@example.test",
      tenantId: "tenant",
      tenantSlug: "tenant",
      venueId: "venue",
      venueName: "Venue",
      venueSlug: "venue",
      role: "MANAGER",
    }));
    for (const payload of [
      {
        deviceId: "device",
        kind: "executeShell",
        key: "test-key",
        shell: "whoami",
      },
      {
        deviceId: "device",
        kind: "printTest",
        key: "test-key",
        url: "http://evil.example",
      },
      {
        deviceId: "device",
        kind: "openDrawer",
        key: "test-key",
        tenantId: "other",
      },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/staff/hardware/command",
            payload,
          })
        ).statusCode,
      ).toBe(400);
  });
});
