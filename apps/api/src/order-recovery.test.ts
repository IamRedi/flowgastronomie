import { describe, expect, it, vi } from "vitest";
import {
  onlineOrderRepository,
  OnlineOrderTrackingNotFoundError,
} from "@flowgastronomie/database";
import { buildApp } from "./app";
import { orderRecoveryCookieName } from "./order-recovery-cookie";

const tracking = {
  venue: {
    name: "Restaurant",
    publicSlug: "venue-a",
    timezone: "Europe/Berlin",
  },
  referenceCode: "RF-ABC123",
  status: "PENDING_CONFIRMATION" as const,
  fulfillmentType: "PICKUP" as const,
  locale: "en" as const,
  totalMinor: 1200,
  currency: "EUR",
  contact: { name: "Guest", phone: "+49 30 123456", email: null },
  requestedFor: new Date("2030-10-06T17:20:00Z"),
  timingMode: "ASAP" as const,
  deliveryAddress: null,
  cateringGuestCount: null,
  guestNotes: null,
  items: [],
  timeline: [],
  messages: [],
};
function app() {
  return buildApp({
    onlineOrderRepository: {
      ...onlineOrderRepository,
      async recover(input) {
        if (
          input.publicSlug !== "venue-a" ||
          input.referenceCode !== "RF-ABC123" ||
          input.phone !== "+49 30 123456"
        )
          throw new OnlineOrderTrackingNotFoundError();
        return {
          sessionToken: "opaque-recovery-session-secret",
          referenceCode: tracking.referenceCode,
        };
      },
      async findTracking(token) {
        if (
          ![
            "opaque-recovery-session-secret",
            "opaque-original-tracking-secret",
          ].includes(token)
        )
          throw new OnlineOrderTrackingNotFoundError();
        return tracking;
      },
      async addGuestMessage(input) {
        if (input.trackingToken !== "opaque-recovery-session-secret")
          throw new OnlineOrderTrackingNotFoundError();
        return {
          ...tracking,
          messages: [
            {
              author: "GUEST" as const,
              body: input.body,
              createdAt: new Date(),
            },
          ],
        };
      },
    },
  });
}
describe("private order recovery transport", () => {
  it("private SSE preserves configured CORS and streams original and recovered credentials", async () => {
    vi.stubEnv("WEB_ORIGIN", "http://localhost:3300");
    const api = app();
    const origin = await api.listen({ port: 0, host: "127.0.0.1" });
    try {
      for (const recovered of [false, true]) {
        const controller = new AbortController();
        try {
          const response = await fetch(
            `${origin}/v1/public/online-orders/track/${recovered ? "recovered/events?venue=venue-a" : "opaque-original-tracking-secret/events"}`,
            {
              headers: {
                origin: "http://localhost:3300",
                ...(recovered
                  ? {
                      cookie: `${orderRecoveryCookieName("venue-a")}=opaque-recovery-session-secret`,
                    }
                  : {}),
              },
              signal: controller.signal,
            },
          );
          expect(response.status).toBe(200);
          expect(response.headers.get("access-control-allow-origin")).toBe(
            "http://localhost:3300",
          );
          expect(response.headers.get("access-control-allow-credentials")).toBe(
            "true",
          );
          expect(response.headers.get("content-type")).toContain(
            "text/event-stream",
          );
          const first = await response.body!.getReader().read();
          expect(new TextDecoder().decode(first.value)).toContain(
            '"referenceCode":"RF-ABC123"',
          );
          expect(new TextDecoder().decode(first.value)).not.toContain(
            '"requestedFor"',
          );
        } finally {
          controller.abort();
        }
      }
    } finally {
      vi.unstubAllEnvs();
      // Aborted streaming clients can leave idle sockets in the test connection pool.
      api.server.closeAllConnections();
      await api.close();
    }
  });
  it("production recovery cookies require HTTPS", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const api = app();
    try {
      const found = await api.inject({
        method: "POST",
        url: "/v1/public/online-orders/venue-a/recover",
        payload: { referenceCode: "RF-ABC123", phone: tracking.contact.phone },
      });
      expect(found.statusCode).toBe(200);
      expect(String(found.headers["set-cookie"])).toContain("Secure");
    } finally {
      vi.unstubAllEnvs();
      await api.close();
    }
  });
  it("requires both verifiers, scopes the cookie, and reuses tracking and messages", async () => {
    const api = app();
    const missing = await api.inject({
      method: "POST",
      url: "/v1/public/online-orders/venue-a/recover",
      payload: { referenceCode: "RF-ABC123" },
    });
    expect(missing.statusCode).toBe(400);
    const referenceOnly = await api.inject({
      url: "/v1/public/online-orders/track/RF-ABC123",
    });
    expect(referenceOnly.statusCode).toBe(404);
    const found = await api.inject({
      method: "POST",
      url: "/v1/public/online-orders/venue-a/recover",
      payload: { referenceCode: "RF-ABC123", phone: tracking.contact.phone },
    });
    expect(found.json()).toEqual({ referenceCode: "RF-ABC123" });
    expect(found.headers["cache-control"]).toBe("no-store");
    const cookie = String(found.headers["set-cookie"]);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=1800");
    expect(cookie).toContain("Path=/v1/public/online-orders/track");
    const credential = cookie.split(";")[0]!;
    const resumed = await api.inject({
      url: "/v1/public/online-orders/track/recovered?venue=venue-a",
      headers: { cookie: credential },
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().referenceCode).toBe("RF-ABC123");
    expect(resumed.json().requestedFor).toBeUndefined();
    expect(resumed.headers["cache-control"]).toBe("private, no-store");
    const crossVenue = await api.inject({
      url: "/v1/public/online-orders/track/recovered?venue=venue-b",
      headers: {
        cookie: `${orderRecoveryCookieName("venue-b")}=opaque-recovery-session-secret`,
      },
    });
    expect(crossVenue.statusCode).toBe(404);
    const noCookie = await api.inject({
      url: "/v1/public/online-orders/track/recovered?venue=venue-a",
    });
    expect(noCookie.statusCode).toBe(404);
    const message = await api.inject({
      method: "POST",
      url: "/v1/public/online-orders/track/recovered/messages?venue=venue-a",
      headers: { cookie: credential },
      payload: { body: "Thank you" },
    });
    expect(message.statusCode).toBe(200);
    expect(message.json().messages[0].body).toBe("Thank you");
    expect(
      (
        await api.inject({
          url: "/v1/public/online-orders/track/opaque-original-tracking-secret",
        })
      ).statusCode,
    ).toBe(200);
    await api.close();
  });
  it("wrong reference, phone or venue returns the same failure and recovery attempts are limited", async () => {
    const api = app();
    const invalid = [
      {
        venue: "venue-a",
        referenceCode: "RF-WRONG1",
        phone: tracking.contact.phone,
      },
      {
        venue: "venue-a",
        referenceCode: tracking.referenceCode,
        phone: "+49 30 999999",
      },
      {
        venue: "venue-b",
        referenceCode: tracking.referenceCode,
        phone: tracking.contact.phone,
      },
    ];
    for (const input of invalid) {
      const response = await api.inject({
        method: "POST",
        url: `/v1/public/online-orders/${input.venue}/recover`,
        payload: input,
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ code: "ORDER_RECOVERY_FAILED" });
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    for (let i = 0; i < 2; i++)
      await api.inject({
        method: "POST",
        url: "/v1/public/online-orders/venue-a/recover",
        payload: invalid[0]!,
      });
    expect(
      (
        await api.inject({
          method: "POST",
          url: "/v1/public/online-orders/venue-a/recover",
          payload: invalid[0]!,
        })
      ).statusCode,
    ).toBe(429);
    expect(
      (
        await api.inject({
          url: "/v1/public/online-orders/track/opaque-original-tracking-secret",
        })
      ).statusCode,
    ).toBe(200);
    await api.close();
  });
});
