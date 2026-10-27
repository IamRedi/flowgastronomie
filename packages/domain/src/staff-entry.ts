import {
  hasStaffPermission,
  type StaffRole,
  type StaffPermission,
} from "./staff-permissions";
import { SetupImportError } from "./smart-setup";
import type { PlatformLocale } from "./locale";

export function staffEntryPath(
  role: StaffRole,
  locale: PlatformLocale,
  requested?: string | null,
) {
  const fallback =
    role === "BAR"
      ? `/${locale}/staff/bar`
      : role === "KITCHEN"
        ? `/${locale}/staff/kitchen`
        : ["OWNER", "MANAGER"].includes(role)
          ? `/app/${locale}/overview`
          : `/${locale}/staff/radar`;
  if (
    !requested ||
    requested.includes("..") ||
    requested.includes("%") ||
    /[\\\r\n#]/.test(requested)
  )
    return fallback;
  const [pathname, query] = requested.split("?");
  if (
    query &&
    !(
      pathname === `/app/${locale}/onboarding/business-import` &&
      /^import=[a-zA-Z0-9_-]{1,100}$/.test(query)
    )
  )
    return fallback;
  if (
    ["OWNER", "MANAGER"].includes(role) &&
    requested.startsWith(`/app/${locale}/`)
  ) {
    const scoped = pathname!.slice(`/app/${locale}/`.length);
    const restricted: Array<[string, StaffPermission]> = [
      ["billing", "BILLING_VIEW"],
      ["settings/domain", "WEBSITE_DOMAIN_MANAGE"],
      ["costs", "WORKFORCE_PRIVATE_MANAGE"],
      ["legal-holds", "LEGAL_HOLD_MANAGE"],
    ];
    if (
      restricted.some(
        ([path, permission]) =>
          (scoped === path || scoped.startsWith(path + "/")) &&
          !hasStaffPermission(role, permission),
      )
    )
      return fallback;
    return requested;
  }
  const allowed =
    role === "BAR"
      ? ["bar", "profile"]
      : role === "KITCHEN"
        ? ["kitchen", "profile"]
        : ["OWNER", "MANAGER"].includes(role)
          ? [
              "menu",
              "pos",
              "orders",
              "radar",
              "bar",
              "kitchen",
              "profile",
              "team",
              "reports",
              "tables",
            ]
          : ["pos", "orders", "radar", "profile"];
  return allowed.some((path) => requested === `/${locale}/staff/${path}`)
    ? requested
    : fallback;
}

/** null preserves pre-channel legacy publication; explicit POS choices never publish publicly. */
export function enabledInPos(
  product: {
    posEnabled?: boolean | null;
    published: boolean;
    available: boolean;
    archivedAt?: unknown;
  },
  categoryPublished: boolean,
) {
  return (
    !product.archivedAt &&
    product.available &&
    (product.posEnabled ?? (product.published && categoryPublished))
  );
}
export function assertPosActivation(
  products: Array<{
    priceMinor: number;
    variants: Array<{ available: boolean; isDefault: boolean }>;
  }>,
) {
  if (
    products.some(
      (p) =>
        !Number.isInteger(p.priceMinor) ||
        p.priceMinor < 0 ||
        (p.variants.length > 0 &&
          !p.variants.some((v) => v.available && v.isDefault)),
    )
  )
    throw new SetupImportError("REVIEW_REQUIRED");
}
