import webpush from "web-push";
import { createHash } from "node:crypto";
import {
  workforceNotificationOutbox,
  type WorkforceDeliveryClaim,
} from "@flowgastronomie/database";
import {
  workforceNoticeLinkSchema,
  workforceNotificationPath,
  workforcePrivatePushCopy,
  workforcePushSubscriptionSchema,
  type WorkforceNotificationCategory,
} from "@flowgastronomie/domain";
import { createTransactionalNotificationServiceFromEnvironment } from "./brevo-transactional-notifications.js";
import {
  disabledTransactionalNotificationService,
  type TransactionalNotificationService,
} from "./transactional-notifications.js";
export type WorkforcePushService = {
  provider: "disabled" | "webpush" | "test";
  send(
    claim: WorkforceDeliveryClaim,
    payload: {
      notificationId: string;
      title: string;
      body: string;
      path: string;
    },
  ): Promise<void>;
};
export const disabledWorkforcePushService: WorkforcePushService = {
  provider: "disabled",
  async send() {},
};
export function workforcePushServiceFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): WorkforcePushService {
  const provider = env.WORKFORCE_PUSH_PROVIDER?.trim() ?? "disabled";
  if (provider === "disabled") return disabledWorkforcePushService;
  if (
    provider !== "webpush" ||
    !env.WORKFORCE_VAPID_PUBLIC_KEY ||
    !env.WORKFORCE_VAPID_PRIVATE_KEY ||
    !env.WORKFORCE_VAPID_SUBJECT
  )
    throw new Error("Workforce push configuration is incomplete.");
  const vapidDetails = {
    subject: env.WORKFORCE_VAPID_SUBJECT,
    publicKey: env.WORKFORCE_VAPID_PUBLIC_KEY,
    privateKey: env.WORKFORCE_VAPID_PRIVATE_KEY,
  };
  return {
    provider: "webpush",
    async send(claim, payload) {
      const subscription = workforcePushSubscriptionSchema.parse({
        consentConfirmed: true,
        subscription: claim.subscription,
      }).subscription;
      await webpush.sendNotification(
        {
          ...subscription,
          expirationTime: subscription.expirationTime ?? null,
        },
        JSON.stringify(payload),
        {
          vapidDetails,
          timeout: 5000,
          TTL: 3600,
          topic: createHash("sha256")
            .update(claim.notification.id)
            .digest("base64url")
            .slice(0, 32),
        },
      );
    },
  };
}
export function createWorkforceNotificationWorker(
  options: {
    emailService?: TransactionalNotificationService;
    emailProvider?: "disabled" | "brevo" | "test";
    pushService?: WorkforcePushService;
    clock?: () => Date;
  } = {},
) {
  const email =
      options.emailService ??
      createTransactionalNotificationServiceFromEnvironment(),
    emailProvider =
      email === disabledTransactionalNotificationService
        ? "disabled"
        : (options.emailProvider ?? "brevo"),
    push = options.pushService ?? workforcePushServiceFromEnvironment(),
    clock = options.clock ?? (() => new Date());
  return {
    async runOnce(limit = 100) {
      const results: { id: string; state: string }[] = [];
      for (let i = 0; i < Math.min(500, Math.max(1, limit)); i++) {
        const claim = await workforceNotificationOutbox.claim(clock());
        if (!claim) break;
        const provider =
          claim.channel === "EMAIL" ? emailProvider : push.provider;
        const disabled =
          claim.disabledCode ??
          (provider === "disabled"
            ? "PROVIDER_DISABLED"
            : await workforceNotificationOutbox.authorizeClaim(claim, clock()));
        if (disabled) {
          const r = await workforceNotificationOutbox.finish(
            claim,
            "DISABLED",
            provider,
            disabled,
            clock(),
          );
          results.push({ id: claim.id, state: r.state ?? "LEASE_LOST" });
          continue;
        }
        try {
          const link = workforceNoticeLinkSchema.parse(
            (claim.notification.payload as { link: unknown }).link,
          );
          if (claim.channel === "EMAIL") {
            if (!claim.recipient) throw new Error("RECIPIENT_UNAVAILABLE");
            await email.send({
              kind: "WORKFORCE_UPDATE",
              notificationId: claim.notification.id,
              recipient: claim.recipient,
              locale: claim.notification.locale,
              category: claim.notification
                .category as WorkforceNotificationCategory,
              link,
            });
          } else {
            const copy = workforcePrivatePushCopy(claim.notification.locale);
            await push.send(claim, {
              notificationId: claim.notification.id,
              ...copy,
              path: workforceNotificationPath(claim.notification.locale, {
                tab: "inbox",
                ...(link.month ? { month: link.month } : {}),
              }),
            });
          }
          const r = await workforceNotificationOutbox.finish(
            claim,
            "DELIVERED",
            provider,
            null,
            clock(),
          );
          results.push({ id: claim.id, state: r.state ?? "LEASE_LOST" });
        } catch (e) {
          const status =
            typeof e === "object" && e !== null && "statusCode" in e
              ? Number(e.statusCode)
              : null;
          const outcome =
            claim.channel === "PUSH" && [404, 410].includes(status ?? 0)
              ? "DISABLED"
              : "FAILURE";
          const r = await workforceNotificationOutbox.finish(
            claim,
            outcome,
            provider,
            outcome === "DISABLED" ? "PUSH_ENDPOINT_GONE" : "DELIVERY_FAILED",
            clock(),
          );
          results.push({ id: claim.id, state: r.state ?? "LEASE_LOST" });
        }
      }
      return { processed: results.length, results };
    },
  };
}
