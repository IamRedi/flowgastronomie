"use client";
import { hasStaffPermission } from "@flowgastronomie/domain";
import { usePilotStaff } from "../../../pilot-app-shell";
import type {
  ServiceMode,
  StaffRole,
  SubscriptionPlan,
  SimplePilotOrder,
  DailyOperationsReport,
} from "@flowgastronomie/domain";
import { useEffect, useState, type ComponentProps } from "react";
import type { Dictionary } from "../../../../lib/dictionaries";
import { type Locale } from "../../../../lib/i18n";
import { pilotText } from "../../../../lib/pilot-copy";
import { dashboardText } from "../../../../lib/pilot-dashboard-copy";
import { PilotIcon } from "../../../[lang]/staff/pilot-icon";
import { PilotDialog } from "../../../[lang]/staff/pilot-dialog";
import { reconciliationText } from "../../../../lib/order-reconciliation-copy";
import { ReconciliationNotes } from "../../../../components/payment-reconciliation";
export type Overview = {
  actor: { displayName: string; email: string; role: StaffRole };
  organization: { id: string; name: string; slug: string };
  venue: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    currency: string;
    defaultServiceMode: ServiceMode;
  };
  subscription: {
    plan: SubscriptionPlan;
    status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
    trialEndsAt: string | null;
    enabledFeatures: number;
    features: string[];
    staffSeatLimit: number | null;
  } | null;
  launch: {
    completed: number;
    total: number;
    steps: Record<LaunchStep, boolean>;
  };
  content: {
    categories: number;
    products: number;
    publishedProducts: number;
    areas: number;
    tables: number;
    activeQrTables: number;
    teamMembers: number;
  };
  live: {
    openTableSessions: number;
    actionableSignals: number;
    activeOrders: number;
    activeShifts: number;
  };
};

type LaunchStep = "account" | "venue" | "menu" | "area" | "tableQr" | "team";
type IconName = ComponentProps<typeof PilotIcon>["name"];
type Live = {
  orders: SimplePilotOrder[];
  registerOpen: boolean;
  updatedAt: Date;
};

function ManagementOverview({
  labels,
  locale,
  modeLabels,
  planLabels,
}: {
  launchLabels: Dictionary["launchAdmin"];
  labels: Dictionary["workspace"];
  locale: Locale;
  modeLabels: Dictionary["menuPage"]["modes"];
  planLabels: Dictionary["pricing"]["plans"];
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "error" | "forbidden"
  >("loading");
  const [live, setLive] = useState<Live | null>(null);
  const [report, setReport] = useState<DailyOperationsReport | null>(null);
  const [liveError, setLiveError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [panel, setPanel] = useState<"venue" | null>(null);
  const api =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const text = pilotText(locale);
  const words = dashboardText(locale);
  const recon = reconciliationText(locale);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy) return;
      busy = true;
      const options = {
        credentials: "include" as const,
        cache: "no-store" as const,
        signal: controller.signal,
      };
      try {
        const [overviewResult, ordersResult, registerResult] =
          await Promise.allSettled([
            fetch(`${api}/v1/workspace/overview`, options),
            fetch(`${api}/v1/staff/pilot/orders`, options),
            fetch(`${api}/v1/staff/register`, options),
          ]);
        if (controller.signal.aborted) return;
        if (overviewResult.status !== "fulfilled") throw new Error();
        const response = overviewResult.value;
        if (response.status === 401) {
          window.location.assign(`/${locale}/staff/login`);
          return;
        }
        if (response.status === 403) {
          setState("forbidden");
          return;
        }
        if (!response.ok) throw new Error();
        const nextOverview = (await response.json()) as Overview;
        if (controller.signal.aborted) return;
        setOverview(nextOverview);
        setState("ready");
        if (
          hasStaffPermission(nextOverview.actor.role, "SHIFT_REPORT") &&
          nextOverview.subscription?.features.includes("REPORTING")
        ) {
          const daily = await fetch(
            `${api}/v1/staff/reports/daily`,
            options,
          ).catch(() => null);
          const nextReport = daily?.ok
            ? ((await daily.json()) as DailyOperationsReport)
            : null;
          if (controller.signal.aborted) return;
          setReport(nextReport?.scope === "VENUE" ? nextReport : null);
        } else setReport(null);
        if (
          ordersResult.status === "fulfilled" &&
          ordersResult.value.ok &&
          registerResult.status === "fulfilled" &&
          registerResult.value.ok
        ) {
          const [orders, register] = await Promise.all([
            ordersResult.value.json() as Promise<SimplePilotOrder[]>,
            registerResult.value.json() as Promise<{ session: unknown | null }>,
          ]);
          if (controller.signal.aborted) return;
          setLive({
            orders,
            registerOpen: Boolean(register.session),
            updatedAt: new Date(),
          });
          setLiveError(false);
        } else {
          setLive(null);
          setLiveError(true);
        }
      } catch {
        if (!controller.signal.aborted) {
          setState("error");
          setLive(null);
          setReport(null);
        }
      } finally {
        busy = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [api, locale, retry]);

  if (!overview || state === "forbidden")
    return (
      <main className="workspace-state">
        <span className="brand-mark">FG</span>
        <p role="status">
          {state === "forbidden"
            ? labels.permissions
            : state === "error"
              ? labels.error
              : labels.loading}
        </p>
        {state === "error" && (
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            {text.refresh}
          </button>
        )}
      </main>
    );
  const money = (value: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: report?.currency ?? overview.venue.currency,
    }).format(value / 100);
  const attention = live
    ? [
        {
          label: words.awaiting,
          value: live.orders.filter(
            (order) =>
              order.source === "WEBSITE" &&
              order.lifecycleStatus === "PENDING_CONFIRMATION",
          ).length,
          icon: "website" as const,
        },
        {
          label: words.handoff,
          value: live.orders.filter((order) => order.canComplete).length,
          icon: "ready" as const,
        },
        {
          label: words.pending,
          value: live.orders.filter(
            (order) => order.paymentStatus === "PENDING_PAYMENT",
          ).length,
          icon: "payment" as const,
        },
      ]
    : [];
  const daily = report?.reconciliation;
  return (
    <>
      <main className="desk-main">
        <header className="desk-header">
          <h2>{words.today}</h2>
          <span className="desk-date">
            {report
              ? `${report.date} · ${report.timezone}`
              : overview.venue.timezone}
          </span>
          <div className="desk-header-actions">
            {overview.organization.id === "demo-tenant" && (
              <span className="desk-demo">{words.demo}</span>
            )}
            <button
              type="button"
              className="pilot-icon-button"
              aria-label={words.venue}
              onClick={() => setPanel("venue")}
            >
              <PilotIcon name="info" />
            </button>
          </div>
        </header>
        {(liveError || state === "error") && (
          <div className="desk-error" role="alert">
            {words.unavailable}
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              {text.refresh}
            </button>
          </div>
        )}
        <section className="desk-service" aria-label={words.service}>
          <div className="desk-section-label">
            <h2>{recon.live}</h2>
            {live && (
              <time dateTime={live.updatedAt.toISOString()}>
                {words.updated}{" "}
                {new Intl.DateTimeFormat(locale, {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: overview.venue.timezone,
                }).format(live.updatedAt)}
              </time>
            )}
          </div>
          <div className="desk-statuses">
            <Metric
              icon="orders"
              label={text.active}
              value={live ? live.orders.length : "—"}
              testId="active-orders"
            />
            <Metric
              icon="kitchen"
              label={text.preparing}
              value={
                live
                  ? live.orders.filter(
                      (order) => order.productionStatus === "PREPARING",
                    ).length
                  : "—"
              }
            />
            <Metric
              icon="ready"
              label={text.ready}
              value={
                live
                  ? live.orders.filter(
                      (order) => order.productionStatus === "READY",
                    ).length
                  : "—"
              }
              testId="ready-orders"
            />
            <Metric
              icon="payment"
              label={words.pending}
              value={
                live
                  ? live.orders.filter(
                      (order) => order.paymentStatus === "PENDING_PAYMENT",
                    ).length
                  : "—"
              }
              testId="pending-payments"
            />
            <a
              className={`desk-register ${live?.registerOpen ? "is-open" : ""}`}
              href={`/${locale}/staff/pos`}
              data-testid="register-status"
            >
              <PilotIcon name="counter" />
              <span>
                {!live
                  ? text.unknown
                  : live.registerOpen
                    ? words.registerOpen
                    : words.registerClosed}
              </span>
            </a>
          </div>
        </section>
        <div className="desk-information">
          <section className="desk-today" aria-label={words.today}>
            <h2>{words.today}</h2>
            {daily ? (
              <>
                <div className="desk-daily-figures">
                  <div>
                    <span>{recon.ordersToday}</span>
                    <strong data-testid="daily-orders">
                      {daily.ordersCreated.count}
                    </strong>
                  </div>
                  <div>
                    <span>{recon.orderValue}</span>
                    <strong data-testid="daily-order-value">
                      {money(daily.ordersCreated.orderValueMinor)}
                    </strong>
                  </div>
                  <div>
                    <span>{recon.paidTodayOrders}</span>
                    <strong data-testid="daily-paid-orders">
                      {money(daily.ordersCreated.paidMinor)}
                    </strong>
                  </div>
                  <div>
                    <span>{recon.pendingTodayOrders}</span>
                    <strong data-testid="daily-pending-orders">
                      {money(daily.ordersCreated.pendingMinor)}
                    </strong>
                  </div>
                </div>
                {daily.ordersCreated.unallocatedMinor > 0 && (
                  <p className="desk-unallocated">
                    {recon.unallocated}:{" "}
                    {money(daily.ordersCreated.unallocatedMinor)}
                  </p>
                )}
                <div className="desk-recorded-payments">
                  <span>{recon.recordedToday}</span>
                  <strong data-testid="daily-payments">
                    {money(daily.paymentsRecorded.totalMinor)}
                  </strong>
                </div>
                <dl className="desk-payment-split">
                  <div>
                    <dt>{words.cash}</dt>
                    <dd>{money(daily.paymentsRecorded.cashMinor)}</dd>
                  </div>
                  <div>
                    <dt>{words.card}</dt>
                    <dd>{money(daily.paymentsRecorded.cardMinor)}</dd>
                  </div>
                  <div>
                    <dt>{recon.methods.OTHER}</dt>
                    <dd>{money(daily.paymentsRecorded.otherMinor)}</dd>
                  </div>
                </dl>
                <details className="desk-reconciliation-details">
                  <summary>{recon.details}</summary>
                  <ReconciliationNotes data={daily} locale={locale} />
                  <p>
                    {recon.earlierOrders}:{" "}
                    {money(daily.paymentsRecorded.earlierOrdersMinor)}
                  </p>
                  <a href={`/${locale}/staff/reports#reconciliation`}>
                    {recon.fullReport}
                  </a>
                </details>
              </>
            ) : (
              <p role="status">— {words.reportUnavailable}</p>
            )}
          </section>
          <section className="desk-attention" aria-label={words.attention}>
            <h2>{words.attention}</h2>
            {!live ? (
              <p>{words.unavailable}</p>
            ) : attention.every((item) => item.value === 0) ? (
              <p className="desk-empty">
                <PilotIcon name="ready" />
                {words.emptyActivity}
              </p>
            ) : (
              <ul>
                {attention
                  .filter((item) => item.value > 0)
                  .map((item) => (
                    <li key={item.label}>
                      <a href={`/${locale}/staff/orders`}>
                        <PilotIcon name={item.icon} />
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </a>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </div>
        <footer className="desk-footer">
          <span>
            {overview.content.publishedProducts} {words.products}{" "}
            <span aria-hidden="true">·</span> {overview.content.tables}{" "}
            {words.tables}
          </span>
          <button type="button" onClick={() => setPanel("venue")}>
            {words.venue}
            <PilotIcon name="info" />
          </button>
        </footer>
      </main>
      {panel && (
        <PilotDialog
          className="desk-drawer"
          title={words.venue}
          closeLabel={text.close}
          onClose={() => setPanel(null)}
        >
          {panel === "venue" && (
            <dl className="desk-info">
              <dt>{labels.venueLabel}</dt>
              <dd>{overview.venue.name}</dd>
              <dt>{labels.overview}</dt>
              <dd>{overview.organization.name}</dd>
              <dt>{words.service}</dt>
              <dd>{modeLabels[overview.venue.defaultServiceMode]}</dd>
              <dt>{words.tables}</dt>
              <dd>{overview.content.tables}</dd>
              <dt>{words.products}</dt>
              <dd>{overview.content.publishedProducts}</dd>
              <dt>{labels.modules.subscription}</dt>
              <dd>
                {overview.subscription
                  ? planLabels[overview.subscription.plan].name
                  : "—"}
              </dd>
              <dt>{labels.live.shifts}</dt>
              <dd>{overview.live.activeShifts}</dd>
            </dl>
          )}
        </PilotDialog>
      )}
    </>
  );
}
function Metric({
  icon,
  label,
  value,
  testId,
}: {
  icon: IconName;
  label: string;
  value: number | string;
  testId?: string;
}) {
  return (
    <div className="desk-metric" data-testid={testId}>
      <PilotIcon name={icon} />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
export function OwnerOverviewClient(
  props: ComponentProps<typeof ManagementOverview>,
) {
  const staff = usePilotStaff();
  if (!staff) return null;
  if (hasStaffPermission(staff.role, "WORKSPACE_OVERVIEW_VIEW"))
    return <ManagementOverview {...props} />;
  const words = dashboardText(props.locale);
  return (
    <main className="desk-main">
      <section className="desk-today">
        <h2>{words.service}</h2>
        <p>{words.staffWelcome}</p>
      </section>
    </main>
  );
}
