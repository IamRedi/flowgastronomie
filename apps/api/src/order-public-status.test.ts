import { describe, expect, it, vi } from "vitest";
import {
  onlineOrderRepository,
  OnlineOrderTrackingNotFoundError,
} from "@flowgastronomie/database";
import { buildApp } from "./app";

function fixture() {
  const findPublicStatus = vi.fn(
    async (input: { publicSlug: string; referenceCode: string }) => {
      if (input.publicSlug !== "venue-a" || input.referenceCode !== "RF-ABC123")
        throw new OnlineOrderTrackingNotFoundError();
      return {
        status: "READY" as const,
        requestedFor: "2030-10-06T17:20:00.000Z",
        venue: {
          name: "Restaurant",
          timezone: "Europe/Berlin",
          tenantId: "private-tenant",
        },
        // Deliberately over-rich adapter: the HTTP boundary must still strip these.
        contact: {
          name: "Private Guest",
          phone: "+49123456",
          email: "private@example.test",
        },
        totalMinor: 1200,
        items: [{ productName: "Private product" }],
        messages: [{ body: "Private message" }],
        timeline: [{ status: "ACCEPTED" }],
        trackingToken: "private-credential",
      };
    },
  );
  return {
    api: buildApp({
      onlineOrderRepository: { ...onlineOrderRepository, findPublicStatus },
    }),
    findPublicStatus,
  };
}

describe("reference-only public status boundary", () => {
  it("returns only status/time/venue, without credentials, cookies or private fields", async () => {
    const { api, findPublicStatus } = fixture();
    try {
      const result = await api.inject({
        method: "POST",
        url: "/v1/public/online-orders/venue-a/status",
        payload: { referenceCode: " rf-abc123 " },
      });
      expect(result.statusCode).toBe(200);
      expect(findPublicStatus).toHaveBeenCalledWith({
        publicSlug: "venue-a",
        referenceCode: "RF-ABC123",
      });
      expect(result.json()).toEqual({
        status: "READY",
        requestedFor: "2030-10-06T17:20:00.000Z",
        venue: { name: "Restaurant", timezone: "Europe/Berlin" },
      });
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(result.headers["set-cookie"]).toBeUndefined();
    } finally {
      await api.close();
    }
  });
  it("gives the same failure for malformed, missing, cross-venue and unexpected-field requests", async () => {
    const { api } = fixture();
    try {
      for (const [slug, payload] of [
        ["venue-a", {}],
        ["venue-a", { referenceCode: "not-a-code" }],
        ["venue-a", { referenceCode: "RF-NOT123" }],
        ["venue-b", { referenceCode: "RF-ABC123" }],
        ["venue-a", { referenceCode: "RF-ABC123", phone: "+49123456" }],
      ] as const) {
        const result = await api.inject({
          method: "POST",
          url: `/v1/public/online-orders/${slug}/status`,
          payload,
        });
        expect(result.statusCode).toBe(404);
        expect(result.json()).toEqual({ code: "ORDER_STATUS_UNAVAILABLE" });
        expect(result.headers["set-cookie"]).toBeUndefined();
      }
    } finally {
      await api.close();
    }
  });
  it("limits attempts across codes and venues before resolving another order", async () => {
    const { api, findPublicStatus } = fixture();
    try {
      for (let i = 0; i < 10; i++) {
        const result = await api.inject({
          method: "POST",
          url: `/v1/public/online-orders/venue-${i}/status`,
          payload: { referenceCode: `RF-00000${i}` },
        });
        expect(result.statusCode).toBe(404);
      }
      const blocked = await api.inject({
        method: "POST",
        url: "/v1/public/online-orders/venue-a/status",
        payload: { referenceCode: "RF-ABC123" },
      });
      expect(blocked.statusCode).toBe(429);
      expect(findPublicStatus).toHaveBeenCalledTimes(10);
      expect(blocked.headers["retry-after"]).toBeDefined();
      const otherIp = await api.inject({
        method: "POST",
        url: "/v1/public/online-orders/venue-a/status",
        remoteAddress: "203.0.113.20",
        payload: { referenceCode: "RF-ABC123" },
      });
      expect(otherIp.statusCode).toBe(200);
    } finally {
      await api.close();
    }
  });
});
