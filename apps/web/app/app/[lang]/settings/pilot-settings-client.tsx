"use client";
import { useEffect, useState } from "react";
import { hasStaffPermission } from "@flowgastronomie/domain";
import type { Dictionary } from "../../../../lib/dictionaries";
import type { Locale } from "../../../../lib/i18n";
import { dashboardText } from "../../../../lib/pilot-dashboard-copy";
import { PilotIcon } from "../../../[lang]/staff/pilot-icon";
import { usePilotStaff } from "../../../pilot-app-shell";
import type { Overview } from "../overview/owner-overview-client";
type LaunchStep = keyof Overview["launch"]["steps"];
export function PilotSettingsClient({
  locale,
  labels,
  launchLabels,
}: {
  locale: Locale;
  labels: Dictionary["workspace"];
  launchLabels: Dictionary["launchAdmin"];
}) {
  const staff = usePilotStaff();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!staff || !hasStaffPermission(staff.role, "WORKSPACE_OVERVIEW_VIEW"))
      return;
    const controller = new AbortController();
    fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/v1/workspace/overview`,
      { credentials: "include", signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = (await response.json()) as Overview;
        if (!controller.signal.aborted) setOverview(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [staff]);
  if (!staff || !hasStaffPermission(staff.role, "VENUE_SETUP_VIEW"))
    return (
      <main className="desk-main">
        <p>{labels.permissions}</p>
      </main>
    );
  if (!overview)
    return (
      <main className="desk-main">
        <p role="status">{error ? labels.error : labels.loading}</p>
      </main>
    );
  const hasFeature = (feature: string) =>
    overview.subscription?.features.includes(feature) ?? false;
  const settingsLinks = [
    { label: launchLabels.onboardingNav, href: `/app/${locale}/onboarding` },
    { label: launchLabels.launchNav, href: `/app/${locale}/launch` },
    { label: labels.modules.tables, href: `/${locale}/staff/setup` },
    { label: labels.modules.team, href: `/${locale}/staff/team` },
    ...(hasStaffPermission(staff.role, "BILLING_VIEW")
      ? [
          {
            label: labels.modules.subscription,
            href: `/app/${locale}/settings/billing`,
          },
        ]
      : []),

    ...(hasFeature("RESERVATIONS")
      ? [
          {
            label: labels.modules.reservations,
            href: `/app/${locale}/reservations/settings`,
          },
        ]
      : []),
    ...(hasFeature("RECIPE_COSTING")
      ? [{ label: labels.modules.costs, href: `/${locale}/staff/costs` }]
      : []),
    ...(hasFeature("OPERATIONAL_RETENTION") &&
    hasStaffPermission(staff.role, "LEGAL_HOLD_MANAGE")
      ? [
          {
            label: labels.modules.legalHolds,
            href: `/${locale}/staff/legal-holds`,
          },
        ]
      : []),
    ...(hasFeature("CUSTOMER_TIMELINE")
      ? [
          {
            label: labels.modules.customers,
            href: `/${locale}/staff/customers`,
          },
        ]
      : []),
  ];
  return (
    <main className="desk-main app-settings">
      <header className="desk-header">
        <h1>{dashboardText(locale).settings}</h1>
      </header>{" "}
      <div className="desk-settings-links">
        {settingsLinks.map((link) => (
          <a key={link.href} href={link.href}>
            {link.label}
            <PilotIcon name="chevron" />
          </a>
        ))}
      </div>
      <details className="desk-setup">
        <summary>
          {labels.launch.title} · {overview.launch.completed}/
          {overview.launch.total}
        </summary>
        <ul>
          {(Object.keys(overview.launch.steps) as LaunchStep[]).map((step) => (
            <li key={step}>
              <PilotIcon
                name={overview.launch.steps[step] ? "ready" : "pending"}
              />
              {labels.launch.steps[step]}
            </li>
          ))}
        </ul>
      </details>
    </main>
  );
}
