import Fastify from "fastify";
import { it, expect, vi } from "vitest";
import { registerCreativeRoutes } from "./creative-routes.js";
import type { StaffIdentity } from "@flowgastronomie/database";
const staff = {
  role: "WAITER",
  tenantId: "a",
  venueId: "b",
  userId: "c",
} as StaffIdentity;
it("denies restricted staff before accepting project or asset requests", async () => {
  const app = Fastify();
  registerCreativeRoutes(app, async () => staff);
  for (const path of [
    "/projects",
    "/projects/foreign",
    "/assets",
    "/assets/foreign/content",
  ]) {
    const result = await app.inject({
      method: "GET",
      url: "/v1/staff/creative" + path,
    });
    expect(result.statusCode).toBe(403);
  }
  await app.close();
});
it("validates transport input and cannot accept tenant scope in a create body", async () => {
  const app = Fastify();
  registerCreativeRoutes(app, async () => ({ ...staff, role: "MANAGER" }));
  const result = await app.inject({
    method: "POST",
    url: "/v1/staff/creative/projects",
    payload: {
      tenantId: "foreign",
      title: "Poster",
      format: "A4",
      locale: "en",
    },
  });
  expect(result.statusCode).toBe(400);
  await app.close();
});
