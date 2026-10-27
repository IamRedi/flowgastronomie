"use client";

import { useEffect, useState } from "react";

import type { Locale } from "../../../../lib/i18n";

type Diagnostics = {
  configuration: {
    websitePublished: boolean;
    publishedProducts: number;
    activeTableQrs: number;
    activeTeamMembers: number;
  };
  entitlements: Array<{ feature: string; enabled: boolean }>;
  delivery: { activeZones: number; totalZones: number };
  retention: { healthy: boolean; lastCompletedAt: string | null };
  notification: { enabled: boolean; provider: "BREVO" | "DISABLED" };
};

export function DiagnosticsClient({ locale }: { locale: Locale }) {
  const [data, setData] = useState<Diagnostics | null>(null);
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  useEffect(() => {
    void fetch(`${apiUrl}/v1/workspace/diagnostics`, {
      credentials: "include",
    }).then(async (response) => {
      if (response.status === 401)
        return window.location.assign(`/${locale}/staff/login`);
      if (response.ok) setData((await response.json()) as Diagnostics);
    });
  }, [apiUrl, locale]);
  if (!data)
    return <main className="workspace-state">Loading diagnostics…</main>;
  const status = (value: boolean) => (value ? "Healthy" : "Action required");
  return (
    <main className="launch-page">
      <section className="website-editor-intro">
        <div>
          <p className="eyebrow">Owner support</p>
          <h1>Operational diagnostics</h1>
          <p>Safe setup health without guest data, credentials or raw logs.</p>
        </div>
      </section>
      <section className="launch-check-grid">
        <article>
          <div>
            <h2>Venue configuration</h2>
            <p>
              {data.configuration.publishedProducts} published products ·{" "}
              {data.configuration.activeTableQrs} active QR tables ·{" "}
              {data.configuration.activeTeamMembers} team members
            </p>
          </div>
          <strong>{status(data.configuration.websitePublished)}</strong>
        </article>
        <article>
          <div>
            <h2>Delivery coverage</h2>
            <p>
              {data.delivery.activeZones} active of {data.delivery.totalZones}{" "}
              configured zones
            </p>
          </div>
          <strong>
            {data.delivery.activeZones ? "Healthy" : "Not configured"}
          </strong>
        </article>
        <article>
          <div>
            <h2>Retention</h2>
            <p>
              {data.retention.lastCompletedAt
                ? new Date(data.retention.lastCompletedAt).toLocaleString()
                : "No successful run recorded"}
            </p>
          </div>
          <strong>{status(data.retention.healthy)}</strong>
        </article>
        <article>
          <div>
            <h2>Notifications</h2>
            <p>{data.notification.provider}</p>
          </div>
          <strong>{status(data.notification.enabled)}</strong>
        </article>
      </section>
      <section className="launch-rehearsal">
        <div>
          <h2>Enabled modules</h2>
          <p>
            {data.entitlements
              .filter((entry) => entry.enabled)
              .map((entry) => entry.feature)
              .join(" · ")}
          </p>
        </div>
      </section>
    </main>
  );
}
