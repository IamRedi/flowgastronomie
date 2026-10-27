const slugMaximumLength = 60;

import type { ServiceMode } from "./service-mode";
import type { SubscriptionPlan } from "./subscription";

export function createWorkspaceSlug(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, slugMaximumLength)
    .replace(/-+$/g, "");

  return normalized || "restaurant";
}

export function addWorkspaceSlugSuffix(base: string, suffix: string): string {
  const safeSuffix = suffix.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!safeSuffix) return createWorkspaceSlug(base);
  const availableLength = slugMaximumLength - safeSuffix.length - 1;
  const safeBase = createWorkspaceSlug(base)
    .slice(0, availableLength)
    .replace(/-+$/g, "");
  return `${safeBase}-${safeSuffix}`;
}

export function initialServiceModeForPlan(plan: SubscriptionPlan): ServiceMode {
  if (plan === "WEBSITE") return "MENU_ONLY";
  if (plan === "SMART_SERVICE") return "CALL_AND_REQUEST";
  return "ORDER_AND_CONFIRM";
}
