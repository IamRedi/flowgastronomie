import type { FeatureKey, SubscriptionPlan } from "@flowgastronomie/domain";

import { prisma } from "./client.js";

export class SubscriptionAccessDeniedError extends Error {
  constructor(featureKey: FeatureKey) {
    super("The current subscription does not include " + featureKey);
    this.name = "SubscriptionAccessDeniedError";
  }
}

export type SubscriptionAccess = {
  plan: SubscriptionPlan;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
  trialEndsAt: Date | null;
  features: Array<{
    featureKey: string;
    enabled: boolean;
    limit: number | null;
  }>;
};

export type SubscriptionRepository = {
  getAccess(tenantId: string): Promise<SubscriptionAccess | null>;
  assertFeature(tenantId: string, featureKey: FeatureKey): Promise<void>;
};

export const subscriptionRepository: SubscriptionRepository = {
  async getAccess(tenantId) {
    const subscription = await prisma.subscription.findUnique({
      where: { tenantId },
      include: { entitlements: { orderBy: { featureKey: "asc" } } },
    });
    if (!subscription) return null;
    return {
      plan: subscription.plan,
      status: subscription.status,
      trialEndsAt: subscription.trialEndsAt,
      features: subscription.entitlements.map((entitlement) => ({
        featureKey: entitlement.featureKey,
        enabled: entitlement.enabled,
        limit: entitlement.limitInt,
      })),
    };
  },

  async assertFeature(tenantId, featureKey) {
    const entitlement = await prisma.entitlement.findFirst({
      where: {
        tenantId,
        featureKey,
        enabled: true,
        subscription: {
          status: { in: ["TRIALING", "ACTIVE"] },
          OR: [{ status: "ACTIVE" }, { trialEndsAt: { gt: new Date() } }],
        },
      },
      select: { id: true },
    });
    if (!entitlement) throw new SubscriptionAccessDeniedError(featureKey);
  },
};
