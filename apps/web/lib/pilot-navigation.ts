import { hasStaffPermission, type StaffRole } from "@flowgastronomie/domain";
import { pilotText } from "./pilot-copy";
import { dashboardText } from "./pilot-dashboard-copy";
import type { Locale } from "./i18n";

/** Presentation only: the domain and API remain the permission authority. */
export function pilotNavigation(locale: Locale, role: StaffRole) {
  const text = pilotText(locale);
  const words = dashboardText(locale);
  return [
    {
      key: "home",
      icon: "home" as const,
      label: words.home,
      href: `/app/${locale}/overview`,
      visible: true,
    },
    {
      key: "counter",
      icon: "counter" as const,
      label: text.cashdesk,
      href: `/${locale}/staff/pos`,
      visible: hasStaffPermission(role, "ORDER_CREATE"),
    },
    {
      key: "orders",
      icon: "orders" as const,
      label: text.orders,
      href: `/${locale}/staff/orders`,
      visible: hasStaffPermission(role, "ORDER_CREATE"),
    },
    {
      key: "kitchen",
      icon: "kitchen" as const,
      label: role === "BAR" ? text.bar : text.kitchen,
      href: `/${locale}/staff/${role === "BAR" ? "bar" : "kitchen"}`,
      visible: hasStaffPermission(role, "ORDER_PREPARE"),
    },
    {
      key: "menu",
      icon: "book" as const,
      label: text.menu,
      href: `/${locale}/staff/menu`,
      visible: hasStaffPermission(role, "MENU_MANAGE"),
    },
    {
      key: "website",
      icon: "website" as const,
      label: words.website,
      href: `/app/${locale}/website`,
      visible: hasStaffPermission(role, "WEBSITE_VIEW"),
    },
    {
      key: "marketing",
      icon: "website" as const,
      label: "Marketing",
      href: `/app/${locale}/marketing`,
      visible: hasStaffPermission(role, "CREATIVE_VIEW"),
    },
    {
      key: "workforce",
      icon: "report" as const,
      label: hasStaffPermission(role, "SCHEDULE_MANAGE")
        ? {
            en: "Team & schedule",
            de: "Team & Dienstplan",
            it: "Team e turni",
            sq: "Ekipi dhe orari",
          }[locale]
        : {
            en: "My schedule",
            de: "Mein Dienstplan",
            it: "I miei turni",
            sq: "Orari im",
          }[locale],
      href: `/${locale}/staff/schedule`,
      visible: hasStaffPermission(role, "SCHEDULE_VIEW"),
    },
    {
      key: "report",
      icon: "report" as const,
      label: words.report,
      href: `/${locale}/staff/reports`,
      visible: hasStaffPermission(role, "SHIFT_REPORT"),
    },
    {
      key: "settings",
      icon: "settings" as const,
      label: words.settings,
      href: `/app/${locale}/settings`,
      visible: hasStaffPermission(role, "VENUE_SETUP_VIEW"),
    },
  ].filter((item) => item.visible);
}

export function pilotNavigationActive(
  key: string,
  href: string,
  pathname: string,
) {
  if (pathname === href || pathname.startsWith(`${href}/`)) return true;
  if (
    key === "counter" &&
    /\/staff\/(receipts|payments)(?:\/|$)/.test(pathname)
  )
    return true;
  if (key === "orders" && /\/online-orders$/.test(pathname)) return true;
  if (
    key === "settings" &&
    /\/online-orders\/(settings|delivery-zones)(?:\/|$)/.test(pathname)
  )
    return true;
  return (
    key === "settings" &&
    /\/(?:onboarding|launch|setup|team|schedule|costs|legal-holds|customers|reservations|diagnostics)(?:\/|$)/.test(
      pathname,
    )
  );
}

/** Locale changes and operational subroutes stay in the same primary area. */
export function pilotArea(pathname: string, locale: Locale) {
  return (
    pilotNavigation(locale, "OWNER").find((item) =>
      pilotNavigationActive(item.key, item.href, pathname),
    )?.key ?? pathname.replace(/^\/(?:app\/)?(?:sq|de|it|en)(?=\/)/, "")
  );
}
