export const SUBSCRIPTION_PLANS = [
  "WEBSITE",
  "SMART_SERVICE",
  "RESTAURANT_PRO",
] as const;

export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const FEATURE_KEYS = [
  "PUBLIC_WEBSITE",
  "CUSTOM_DOMAIN",
  "MULTILINGUAL_MENU",
  "QR_MENU",
  "SERVICE_REQUESTS",
  "SERVICE_RADAR",
  "TABLE_MANAGEMENT",
  "GUEST_ORDERING",
  "ONLINE_ORDERING",
  "PRODUCTION_STATIONS",
  "STAFF_SHIFTS",
  "MANUAL_PAYMENTS",
  "REPORTING",
  "RESERVATIONS",
  "RECIPE_COSTING",
  "CUSTOMER_TIMELINE",
  "OPERATIONAL_RETENTION",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type PlanDefinition = {
  key: SubscriptionPlan;
  monthlyPriceMinor: number;
  currency: "EUR";
  trialDays: number;
  featured: boolean;
  limits: {
    venues: number;
    staffSeats: number;
    publishedSites: number;
  };
  features: readonly FeatureKey[];
};

export const PLAN_DEFINITIONS: Readonly<
  Record<SubscriptionPlan, PlanDefinition>
> = {
  WEBSITE: {
    key: "WEBSITE",
    monthlyPriceMinor: 1900,
    currency: "EUR",
    trialDays: 14,
    featured: false,
    limits: { venues: 1, staffSeats: 2, publishedSites: 1 },
    features: [
      "PUBLIC_WEBSITE",
      "CUSTOM_DOMAIN",
      "MULTILINGUAL_MENU",
      "QR_MENU",
    ],
  },
  SMART_SERVICE: {
    key: "SMART_SERVICE",
    monthlyPriceMinor: 3900,
    currency: "EUR",
    trialDays: 14,
    featured: true,
    limits: { venues: 1, staffSeats: 10, publishedSites: 1 },
    features: [
      "PUBLIC_WEBSITE",
      "CUSTOM_DOMAIN",
      "MULTILINGUAL_MENU",
      "QR_MENU",
      "SERVICE_REQUESTS",
      "SERVICE_RADAR",
      "TABLE_MANAGEMENT",
    ],
  },
  RESTAURANT_PRO: {
    key: "RESTAURANT_PRO",
    monthlyPriceMinor: 6900,
    currency: "EUR",
    trialDays: 14,
    featured: false,
    limits: { venues: 1, staffSeats: 30, publishedSites: 1 },
    features: FEATURE_KEYS,
  },
};

export type PlanEntitlement = {
  featureKey: FeatureKey;
  enabled: boolean;
  limit: number | null;
};

export function entitlementsForPlan(plan: SubscriptionPlan): PlanEntitlement[] {
  const definition = PLAN_DEFINITIONS[plan];
  const featureEntitlements = FEATURE_KEYS.map((featureKey) => ({
    featureKey,
    enabled: definition.features.includes(featureKey),
    limit: featureKey === "STAFF_SHIFTS" ? definition.limits.staffSeats : null,
  }));
  return featureEntitlements;
}

export function planIncludesFeature(
  plan: SubscriptionPlan,
  feature: FeatureKey,
) {
  return PLAN_DEFINITIONS[plan].features.includes(feature);
}
