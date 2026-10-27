import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import {
  pilotOperationsRepository,
  type StaffIdentity,
} from "@flowgastronomie/database";
import { registerPilotOperationsRoutes } from "./pilot-operations-routes.js";
import { StaffPermissionDeniedError } from "@flowgastronomie/domain";

afterEach(() => vi.restoreAllMocks());
it("requires staff authentication on every pilot endpoint before repository access", async () => {
  const app = Fastify();
  const production = vi.spyOn(pilotOperationsRepository, "production");
  const counter = vi.spyOn(pilotOperationsRepository, "counter");
  const complete = vi.spyOn(pilotOperationsRepository, "complete");
  const orders = vi.spyOn(pilotOperationsRepository, "orders");
  registerPilotOperationsRoutes(app, async (_request, reply) => {
    reply.code(401).send({ code: "STAFF_AUTH_REQUIRED" });
    return null;
  });
  for (const [method, url] of [
    ["GET", "/v1/staff/production/KITCHEN"],
    ["GET", "/v1/staff/pos/orders"],
    ["GET", "/v1/staff/pilot/orders?view=TODAY&date=2026-10-05"],
    ["POST", "/v1/staff/pos/orders/order/complete"],
  ] as const) {
    expect((await app.inject({ method, url })).statusCode).toBe(401);
  }
  expect(production).not.toHaveBeenCalled();
  expect(counter).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
  expect(orders).not.toHaveBeenCalled();
  await app.close();
});

it("validates historical filters and dates, preserving the array contract and authenticated scope", async () => {
  const app = Fastify();
  const staff = {
    tenantId: "tenant",
    venueId: "venue",
    role: "MANAGER",
  } as StaffIdentity;
  const orders = vi
    .spyOn(pilotOperationsRepository, "orders")
    .mockResolvedValue([]);
  registerPilotOperationsRoutes(app, async () => staff);
  for (const query of ["view=UNKNOWN", "date=05-10-2026", "date=2026-02-30"]) {
    expect(
      (await app.inject(`/v1/staff/pilot/orders?${query}`)).statusCode,
    ).toBe(400);
  }
  expect(orders).not.toHaveBeenCalled();
  const response = await app.inject(
    "/v1/staff/pilot/orders?view=TODAY&date=2026-10-05&tenantId=other&venueId=other",
  );
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual([]);
  expect(orders).toHaveBeenCalledWith(staff, {
    view: "TODAY",
    date: "2026-10-05",
  });
  await app.inject("/v1/staff/pilot/orders");
  expect(orders).toHaveBeenLastCalledWith(staff, {});
  orders.mockRejectedValue(
    new StaffPermissionDeniedError("KITCHEN", "ORDER_CREATE"),
  );
  expect(
    (await app.inject("/v1/staff/pilot/orders?view=PAID")).statusCode,
  ).toBe(403);
  await app.close();
});
it("validates the station and takes scope exclusively from the authenticated staff", async () => {
  const app = Fastify();
  const staff: StaffIdentity = {
    sessionId: "session",
    userId: "user",
    membershipId: "membership",
    tenantId: "tenant",
    venueId: "venue",
    role: "MANAGER",
    displayName: "Manager",
    email: "manager@example.test",
    tenantSlug: "tenant",
    venueSlug: "venue",
    venueName: "Venue",
  };
  const production = vi
    .spyOn(pilotOperationsRepository, "production")
    .mockResolvedValue([]);
  registerPilotOperationsRoutes(app, async () => staff);
  expect((await app.inject("/v1/staff/production/INVALID")).statusCode).toBe(
    400,
  );
  expect(production).not.toHaveBeenCalled();
  expect(
    (
      await app.inject(
        "/v1/staff/production/KITCHEN?tenantId=other&venueId=other",
      )
    ).statusCode,
  ).toBe(200);
  expect(production).toHaveBeenCalledWith(staff, "KITCHEN");
  await app.close();
});
