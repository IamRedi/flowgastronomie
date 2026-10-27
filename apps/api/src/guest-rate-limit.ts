import { isIP } from "node:net";

import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

export class TrustedProxyConfigurationError extends Error {}

export const unauthenticatedRateLimits = {
  passwordReset: {
    max: 5,
    timeWindow: "1 hour",
    groupId: "unauthenticated-password-reset",
  },
  // Manual status checks only; separate from private SSE/polling budgets.
  publicOrderStatus: {
    max: 10,
    timeWindow: "10 minutes",
    groupId: "unauthenticated-public-order-status",
  },
  trackingRecovery: {
    max: 5,
    timeWindow: "10 minutes",
    groupId: "unauthenticated-tracking-recovery",
  },
  publicRead: {
    max: 600,
    timeWindow: "1 minute",
    groupId: "unauthenticated-public-read",
  },
  trackingRead: {
    max: 180,
    timeWindow: "1 minute",
    groupId: "unauthenticated-tracking-read",
  },
  onlineOrderWrite: {
    max: 30,
    timeWindow: "10 minutes",
    groupId: "unauthenticated-online-order-write",
  },
  trackingMessageWrite: {
    max: 60,
    timeWindow: "10 minutes",
    groupId: "unauthenticated-tracking-message-write",
  },
  trialRegistration: {
    max: 5,
    timeWindow: "1 hour",
    groupId: "unauthenticated-trial-registration",
  },
  staffLogin: {
    max: 30,
    timeWindow: "15 minutes",
    groupId: "unauthenticated-staff-login",
  },
  invitationAcceptance: {
    max: 10,
    timeWindow: "1 hour",
    groupId: "unauthenticated-invitation-acceptance",
  },
  qrSessionWrite: {
    max: 120,
    timeWindow: "10 minutes",
    groupId: "unauthenticated-qr-session-write",
  },
  guestOrderWrite: {
    max: 120,
    timeWindow: "10 minutes",
    groupId: "unauthenticated-guest-order-write",
  },
  guestServiceWrite: {
    max: 180,
    timeWindow: "10 minutes",
    groupId: "unauthenticated-guest-service-write",
  },
  demoWrite: {
    max: 60,
    timeWindow: "10 minutes",
    groupId: "unauthenticated-demo-write",
  },
} as const;

export function registerUnauthenticatedRateLimiting(app: FastifyInstance) {
  void app.register(rateLimit, {
    global: false,
    cache: 20_000,
    errorResponseBuilder(_request, context) {
      return {
        statusCode: context.statusCode,
        code: "RATE_LIMIT_EXCEEDED",
        retryAfterSeconds: Math.max(1, Math.ceil(context.ttl / 1_000)),
      };
    },
    onExceeded(request) {
      request.log.warn(
        {
          method: request.method,
          route: request.routeOptions.url,
        },
        "Unauthenticated request rate limit exceeded",
      );
    },
  });

  const handlers = new WeakMap<
    object,
    ReturnType<FastifyInstance["rateLimit"]>
  >();
  app.addHook("onRoute", (route) => {
    const unauthenticated =
      route.url === "/v1/capabilities" ||
      route.url === "/v1/auth/login" ||
      route.url === "/v1/auth/invitations/:token/accept" ||
      route.url.startsWith("/v1/public/") ||
      route.url.startsWith("/v1/demo/");
    const policy = route.config?.rateLimit;
    if (unauthenticated && (!policy || typeof policy !== "object")) {
      throw new Error(
        `Unauthenticated route ${route.method} ${route.url} requires a rate-limit policy`,
      );
    }
  });
  app.addHook("onRequest", async (request, reply) => {
    const options = request.routeOptions.config.rateLimit;
    if (!options || typeof options !== "object") return;

    let handler = handlers.get(options);
    if (!handler) {
      handler = request.server.rateLimit(options);
      handlers.set(options, handler);
    }
    await handler.call(request.server, request, reply);
  });
}

function validProxyAddress(value: string) {
  const slash = value.lastIndexOf("/");
  const address = slash === -1 ? value : value.slice(0, slash);
  const version = isIP(address);
  if (!version) return false;
  if (slash === -1) return true;

  const prefix = Number(value.slice(slash + 1));
  return (
    Number.isInteger(prefix) &&
    prefix >= 0 &&
    prefix <= (version === 4 ? 32 : 128)
  );
}

export function trustedProxyFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): string | false {
  const configured = environment.TRUST_PROXY?.trim();
  if (!configured) {
    if (environment.NODE_ENV === "production") {
      throw new TrustedProxyConfigurationError(
        "TRUST_PROXY must be explicitly set in production",
      );
    }
    return false;
  }

  if (configured.toLowerCase() === "disabled") return false;
  if (configured.toLowerCase() === "true") {
    throw new TrustedProxyConfigurationError(
      "TRUST_PROXY=true is unsafe; configure exact proxy IPs or CIDRs",
    );
  }

  const addresses = configured.split(",").map((value) => value.trim());
  if (
    addresses.length === 0 ||
    addresses.length > 20 ||
    addresses.some((value) => !validProxyAddress(value))
  ) {
    throw new TrustedProxyConfigurationError(
      "TRUST_PROXY must contain only comma-separated proxy IPs or CIDRs",
    );
  }

  return addresses.join(",");
}
