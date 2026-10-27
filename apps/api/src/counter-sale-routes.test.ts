import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  counterSaleRepository,
  type StaffIdentity,
} from "@flowgastronomie/database";
import {
  CounterSaleError,
  StaffPermissionDeniedError,
} from "@flowgastronomie/domain";
import { registerCounterSaleRoutes } from "./counter-sale-routes.js";

const staff: StaffIdentity = {
  sessionId: "session",
  userId: "user",
  membershipId: "member",
  displayName: "Manager",
  email: "manager@example.test",
  tenantId: "tenant",
  tenantSlug: "tenant",
  venueId: "venue",
  venueName: "Venue",
  venueSlug: "venue",
  role: "MANAGER",
};
const servers: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((app) => app.close()));
});
function fixture(authenticated = true) {
  const app = Fastify();
  servers.push(app);
  const pay = vi.fn(counterSaleRepository.pay);
  const open = vi.fn(counterSaleRepository.open);
  const receipt = vi.fn(counterSaleRepository.receipt);
  registerCounterSaleRoutes(
    app,
    async (_request, reply) => {
      if (!authenticated) {
        reply.code(401).send({ code: "STAFF_AUTH_REQUIRED" });
        return null;
      }
      return staff;
    },
    { ...counterSaleRepository, pay, open, receipt },
  );
  return { app, pay, open, receipt };
}
describe("counter-sale transport", () => {
  it("requires staff authentication before payment", async () => {
    const { app, pay } = fixture(false);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/staff/pos/orders/order/payment",
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    expect(pay).not.toHaveBeenCalled();
  });
  it("rejects unconfirmed cards, fractional money and client scope", async () => {
    const { app, pay } = fixture();
    for (const payload of [
      { method: "CARD_AT_COUNTER", terminalConfirmed: false },
      { method: "CASH", receivedMinor: 10.5 },
      { method: "CASH", receivedMinor: 100, tenantId: "other" },
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/staff/pos/orders/order/payment",
            headers: { "idempotency-key": "retry-key" },
            payload,
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(pay).not.toHaveBeenCalled();
  });
  it("requires an idempotency key", async () => {
    const { app, pay } = fixture();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/staff/pos/orders/order/payment",
          payload: { method: "CASH", receivedMinor: 100 },
        })
      ).statusCode,
    ).toBe(400);
    expect(pay).not.toHaveBeenCalled();
  });
  it("passes only authenticated scope and validated data", async () => {
    const { app, pay } = fixture();
    pay.mockRejectedValueOnce(
      new CounterSaleError("REGISTER_REQUIRED", "Open register"),
    );
    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/pos/orders/order/payment",
      headers: { "idempotency-key": "retry-key" },
      payload: { method: "CASH", receivedMinor: 100 },
    });
    expect(response.statusCode).toBe(409);
    expect(pay).toHaveBeenCalledWith(staff, {
      orderId: "order",
      idempotencyKey: "retry-key",
      method: "CASH",
      receivedMinor: 100,
    });
  });
  it("maps denied register management and missing scoped receipt", async () => {
    const { app, open, receipt } = fixture();
    open.mockRejectedValueOnce(
      new StaffPermissionDeniedError("WAITER", "REGISTER_MANAGE"),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/staff/register/open",
          payload: { openingCashMinor: 100 },
        })
      ).statusCode,
    ).toBe(403);
    receipt.mockRejectedValueOnce(
      new CounterSaleError("NOT_FOUND", "Receipt not found"),
    );
    expect(
      (await app.inject({ method: "GET", url: "/v1/staff/receipts/foreign" }))
        .statusCode,
    ).toBe(404);
  });
});
