import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import {
  TrustedProxyConfigurationError,
  trustedProxyFromEnvironment,
} from "./guest-rate-limit.js";

const apps: ReturnType<typeof buildApp>[] = [];

function app(trustProxy: string | false = false) {
  const instance = buildApp({}, { trustProxy });
  apps.push(instance);
  return instance;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((instance) => instance.close()));
});

describe("unauthenticated request rate limiting", () => {
  it("limits trial registration and returns retry metadata", async () => {
    const instance = app();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await instance.inject({
        method: "POST",
        url: "/v1/public/trials",
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    }

    const limited = await instance.inject({
      method: "POST",
      url: "/v1/public/trials",
      payload: {},
    });

    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      statusCode: 429,
      code: "RATE_LIMIT_EXCEEDED",
      retryAfterSeconds: expect.any(Number),
    });
    expect(limited.headers["x-ratelimit-limit"]).toBe("5");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("groups login attempts under a dedicated brute-force limit", async () => {
    const instance = app();

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await instance.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    }

    const limited = await instance.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {},
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["x-ratelimit-limit"]).toBe("30");
  });

  it("limits public online-order writes independently from public reads", async () => {
    const instance = app();
    const plans = await instance.inject({
      method: "GET",
      url: "/v1/public/plans",
    });
    expect(plans.statusCode).toBe(200);
    expect(plans.headers["x-ratelimit-limit"]).toBe("600");

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await instance.inject({
        method: "POST",
        url: "/v1/public/online-orders/demo",
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    }

    const limited = await instance.inject({
      method: "POST",
      url: "/v1/public/online-orders/demo",
      payload: {},
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["x-ratelimit-limit"]).toBe("30");

    const plansAfterWriteLimit = await instance.inject({
      method: "GET",
      url: "/v1/public/plans",
    });
    expect(plansAfterWriteLimit.statusCode).toBe(200);
  });

  it("does not apply guest limits to authenticated staff routes", async () => {
    const instance = app();

    for (let attempt = 0; attempt < 35; attempt += 1) {
      const response = await instance.inject({
        method: "GET",
        url: "/v1/staff/me",
      });
      expect(response.statusCode).toBe(401);
      expect(response.headers["x-ratelimit-limit"]).toBeUndefined();
    }
  });

  it("ignores spoofed forwarding headers when no proxy is trusted", async () => {
    const instance = app();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await instance.inject({
        method: "POST",
        url: "/v1/public/trials",
        headers: { "x-forwarded-for": `203.0.113.${attempt + 1}` },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    }

    const limited = await instance.inject({
      method: "POST",
      url: "/v1/public/trials",
      headers: { "x-forwarded-for": "198.51.100.20" },
      payload: {},
    });
    expect(limited.statusCode).toBe(429);
  });

  it("separates clients forwarded by an explicitly trusted proxy", async () => {
    const instance = app("127.0.0.1");

    for (const clientIp of ["203.0.113.10", "203.0.113.11"]) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await instance.inject({
          method: "POST",
          url: "/v1/public/trials",
          headers: { "x-forwarded-for": clientIp },
          payload: {},
        });
        expect(response.statusCode).toBe(400);
      }
    }

    const firstClientLimited = await instance.inject({
      method: "POST",
      url: "/v1/public/trials",
      headers: { "x-forwarded-for": "203.0.113.10" },
      payload: {},
    });
    expect(firstClientLimited.statusCode).toBe(429);
  });
});

describe("trusted proxy configuration", () => {
  it("defaults to direct-client addresses outside production", () => {
    expect(trustedProxyFromEnvironment({ NODE_ENV: "development" })).toBe(
      false,
    );
    expect(
      trustedProxyFromEnvironment({
        NODE_ENV: "production",
        TRUST_PROXY: "disabled",
      }),
    ).toBe(false);
  });

  it("accepts exact IPv4, IPv6, and CIDR proxy sources", () => {
    expect(
      trustedProxyFromEnvironment({
        NODE_ENV: "production",
        TRUST_PROXY: "127.0.0.1, 10.0.0.0/8, ::1/128",
      }),
    ).toBe("127.0.0.1,10.0.0.0/8,::1/128");
  });

  it("fails fast for missing or unsafe production proxy trust", () => {
    expect(() =>
      trustedProxyFromEnvironment({ NODE_ENV: "production" }),
    ).toThrowError(TrustedProxyConfigurationError);
    expect(() =>
      trustedProxyFromEnvironment({
        NODE_ENV: "production",
        TRUST_PROXY: "true",
      }),
    ).toThrowError(/unsafe/);
    expect(() =>
      trustedProxyFromEnvironment({
        NODE_ENV: "production",
        TRUST_PROXY: "proxy.internal",
      }),
    ).toThrowError(/proxy IPs or CIDRs/);
  });
});
