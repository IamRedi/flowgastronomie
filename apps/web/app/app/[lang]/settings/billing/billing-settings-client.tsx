"use client";

import type {
  BillingInvoiceStatus,
  FeatureKey,
  SubscriptionPlan,
} from "@flowgastronomie/domain";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { Dictionary } from "../../../../../lib/dictionaries";
import type { Locale } from "../../../../../lib/i18n";

type BillingWorkspace = {
  organization: { name: string; slug: string };
  profile: {
    legalName: string;
    billingEmail: string;
    addressLine1: string;
    postalCode: string;
    city: string;
    countryCode: string;
    vatId: string | null;
  } | null;
  subscription: {
    plan: SubscriptionPlan;
    status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
    trialEndsAt: string | null;
    currentPeriodStartedAt: string | null;
    currentPeriodEndsAt: string | null;
    features: Array<{
      featureKey: FeatureKey;
      enabled: boolean;
      limit: number | null;
    }>;
    usage: Array<{ usageKey: string; quantity: number; measuredAt: string }>;
  };
  plans: Array<{
    key: SubscriptionPlan;
    monthlyPriceMinor: number;
    currency: string;
    features: FeatureKey[];
    limits: { venues: number; staffSeats: number; publishedSites: number };
  }>;
  pendingChange: {
    id: string;
    currentPlan: SubscriptionPlan;
    requestedPlan: SubscriptionPlan;
    requestedAt: string;
  } | null;
  invoices: Array<{
    id: string;
    number: string;
    status: BillingInvoiceStatus;
    amountMinor: number;
    currency: string;
    periodStart: string;
    periodEnd: string;
    issuedAt: string;
    dueAt: string;
    paidAt: string | null;
    externalUrl: string | null;
  }>;
};

type Feedback =
  | "profileSaved"
  | "requestSuccess"
  | "cancelSuccess"
  | "samePlan"
  | "requestConflict"
  | "error"
  | null;

export function BillingSettingsClient({
  labels,
  locale,
  planLabels,
}: {
  labels: Dictionary["billingAdmin"];
  locale: Locale;
  planLabels: Dictionary["pricing"]["plans"];
}) {
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const [workspace, setWorkspace] = useState<BillingWorkspace | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "forbidden" | "error"
  >("loading");
  const [busy, setBusy] = useState<"profile" | "plan" | "cancel" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const load = useCallback(async () => {
    const response = await fetch(`${apiUrl}/v1/workspace/billing`, {
      credentials: "include",
      cache: "no-store",
    });
    if (response.status === 401) {
      window.location.assign(`/${locale}/staff/login`);
      return;
    }
    if (response.status === 403) return setState("forbidden");
    if (!response.ok) return setState("error");
    setWorkspace((await response.json()) as BillingWorkspace);
    setState("ready");
  }, [apiUrl, locale]);

  useEffect(() => void load(), [load]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("profile");
    setFeedback(null);
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    const response = await fetch(`${apiUrl}/v1/workspace/billing/profile`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationName: value("organizationName"),
        legalName: value("legalName"),
        billingEmail: value("billingEmail"),
        addressLine1: value("addressLine1"),
        postalCode: value("postalCode"),
        city: value("city"),
        countryCode: value("countryCode"),
        vatId: value("vatId") || null,
      }),
    });
    if (!response.ok) setFeedback("error");
    else {
      setWorkspace((await response.json()) as BillingWorkspace);
      setFeedback("profileSaved");
    }
    setBusy(null);
  }

  async function requestPlan(requestedPlan: SubscriptionPlan) {
    setBusy("plan");
    setFeedback(null);
    const response = await fetch(`${apiUrl}/v1/workspace/billing/plan-change`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestedPlan }),
    });
    if (!response.ok) {
      const error = (await response.json()) as { issues?: string[] };
      setFeedback(
        error.issues?.includes("SAME_PLAN")
          ? "samePlan"
          : error.issues?.includes("REQUEST_ALREADY_PENDING")
            ? "requestConflict"
            : "error",
      );
    } else {
      setWorkspace((await response.json()) as BillingWorkspace);
      setFeedback("requestSuccess");
    }
    setBusy(null);
  }

  async function cancelRequest() {
    if (!workspace?.pendingChange) return;
    setBusy("cancel");
    setFeedback(null);
    const response = await fetch(
      `${apiUrl}/v1/workspace/billing/plan-change/${workspace.pendingChange.id}`,
      { method: "DELETE", credentials: "include" },
    );
    if (!response.ok) setFeedback("error");
    else {
      setWorkspace((await response.json()) as BillingWorkspace);
      setFeedback("cancelSuccess");
    }
    setBusy(null);
  }

  if (state !== "ready" || !workspace) {
    return (
      <main className="workspace-state">
        {state === "forbidden"
          ? labels.ownerOnly
          : state === "error"
            ? labels.error
            : labels.loading}
      </main>
    );
  }

  const money = (amountMinor: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      amountMinor / 100,
    );
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      new Date(value),
    );
  const usage = Object.fromEntries(
    workspace.subscription.usage.map((item) => [item.usageKey, item.quantity]),
  );
  const profile = workspace.profile;
  const currentDefinition = workspace.plans.find(
    (plan) => plan.key === workspace.subscription.plan,
  )!;
  const statusLabels = {
    TRIALING: labels.trialing,
    ACTIVE: labels.active,
    PAST_DUE: labels.pastDue,
    CANCELLED: labels.cancelled,
  };

  return (
    <main className="billing-page">
      <section className="website-editor-intro">
        <div>
          <p className="eyebrow">{labels.eyebrow}</p>
          <h1>{labels.title}</h1>
          <p>{labels.subtitle}</p>
        </div>
      </section>

      {feedback && (
        <p
          className={`website-feedback ${["error", "samePlan", "requestConflict"].includes(feedback) ? "error" : "success"}`}
          role="status"
        >
          {labels[feedback]}
        </p>
      )}

      <section className="billing-current">
        <div>
          <p>{labels.currentPlan}</p>
          <h2>{planLabels[workspace.subscription.plan].name}</h2>
          <span
            className={`subscription-status ${workspace.subscription.status.toLowerCase()}`}
          >
            {statusLabels[workspace.subscription.status]}
          </span>
        </div>
        <strong>
          {money(
            currentDefinition.monthlyPriceMinor,
            currentDefinition.currency,
          )}
          <small>{labels.perMonth}</small>
        </strong>
        <div>
          {workspace.subscription.status === "TRIALING" &&
            workspace.subscription.trialEndsAt && (
              <span>
                {labels.trialUntil} {date(workspace.subscription.trialEndsAt)}
              </span>
            )}
          {workspace.subscription.currentPeriodEndsAt && (
            <span>
              {labels.periodUntil}{" "}
              {date(workspace.subscription.currentPeriodEndsAt)}
            </span>
          )}
        </div>
      </section>

      <section className="website-editor-card">
        <h2>{labels.usage}</h2>
        <div className="billing-usage-grid">
          <Usage
            label={labels.staffSeats}
            value={usage.STAFF_SEATS ?? 0}
            limit={currentDefinition.limits.staffSeats}
          />
          <Usage
            label={labels.publishedSites}
            value={usage.PUBLISHED_SITES ?? 0}
            limit={currentDefinition.limits.publishedSites}
          />
          <Usage
            label={labels.venues}
            value={usage.VENUES ?? 1}
            limit={currentDefinition.limits.venues}
          />
        </div>
      </section>

      {workspace.pendingChange && (
        <section className="billing-pending">
          <div>
            <strong>{labels.pendingTitle}</strong>
            <span>
              {planLabels[workspace.pendingChange.currentPlan].name} →{" "}
              {planLabels[workspace.pendingChange.requestedPlan].name}
            </span>
            <small>{labels.pendingText}</small>
          </div>
          <button
            className="button button-ghost"
            disabled={busy !== null}
            onClick={() => void cancelRequest()}
            type="button"
          >
            {labels.cancelRequest}
          </button>
        </section>
      )}

      <section className="website-editor-card">
        <h2>{labels.plans}</h2>
        <div className="billing-plan-grid">
          {workspace.plans.map((plan) => {
            const isCurrent = plan.key === workspace.subscription.plan;
            return (
              <article className={isCurrent ? "current" : ""} key={plan.key}>
                <div>
                  <h3>{planLabels[plan.key].name}</h3>
                  <p>{planLabels[plan.key].description}</p>
                </div>
                <strong>
                  {money(plan.monthlyPriceMinor, plan.currency)}{" "}
                  <small>{labels.perMonth}</small>
                </strong>
                <span>
                  {plan.features.length} features · {plan.limits.staffSeats}{" "}
                  {labels.staffSeats}
                </span>
                <button
                  className={
                    isCurrent ? "button button-ghost" : "button button-primary"
                  }
                  disabled={
                    isCurrent ||
                    busy !== null ||
                    workspace.pendingChange !== null
                  }
                  onClick={() => void requestPlan(plan.key)}
                  type="button"
                >
                  {isCurrent
                    ? labels.current
                    : busy === "plan"
                      ? labels.requesting
                      : labels.request}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="website-editor-card">
        <h2>{labels.profile}</h2>
        <form className="billing-profile-form" onSubmit={saveProfile}>
          <BillingInput
            defaultValue={workspace.organization.name}
            label={labels.organizationName}
            name="organizationName"
          />
          <BillingInput
            defaultValue={profile?.legalName ?? ""}
            label={labels.legalName}
            name="legalName"
          />
          <BillingInput
            defaultValue={profile?.billingEmail ?? ""}
            label={labels.billingEmail}
            name="billingEmail"
            type="email"
          />
          <BillingInput
            defaultValue={profile?.addressLine1 ?? ""}
            label={labels.address}
            name="addressLine1"
          />
          <BillingInput
            defaultValue={profile?.postalCode ?? ""}
            label={labels.postalCode}
            name="postalCode"
          />
          <BillingInput
            defaultValue={profile?.city ?? ""}
            label={labels.city}
            name="city"
          />
          <BillingInput
            defaultValue={profile?.countryCode ?? "DE"}
            label={labels.countryCode}
            maxLength={2}
            name="countryCode"
          />
          <BillingInput
            defaultValue={profile?.vatId ?? ""}
            label={labels.vatId}
            name="vatId"
            required={false}
          />
          <button
            className="button button-primary"
            disabled={busy !== null}
            type="submit"
          >
            {busy === "profile" ? labels.saving : labels.saveProfile}
          </button>
        </form>
      </section>

      <section className="website-editor-card">
        <h2>{labels.invoices}</h2>
        {workspace.invoices.length ? (
          <div className="billing-invoices">
            {workspace.invoices.map((invoice) => (
              <article key={invoice.id}>
                <strong>{invoice.number}</strong>
                <span>
                  <small>{labels.issued}</small>
                  {date(invoice.issuedAt)}
                </span>
                <span>
                  <small>{labels.period}</small>
                  {date(invoice.periodStart)} – {date(invoice.periodEnd)}
                </span>
                <b>{money(invoice.amountMinor, invoice.currency)}</b>
                <em className={invoice.status.toLowerCase()}>
                  {
                    labels[
                      invoice.status.toLowerCase() as "paid" | "open" | "void"
                    ]
                  }
                </em>
                {invoice.externalUrl && (
                  <a
                    href={invoice.externalUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {labels.download}
                  </a>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p>{labels.noInvoices}</p>
        )}
        <p className="billing-boundary">{labels.paymentBoundary}</p>
      </section>
    </main>
  );
}

function Usage({
  label,
  limit,
  value,
}: {
  label: string;
  limit: number;
  value: number;
}) {
  const percent = Math.min(100, Math.round((value / limit) * 100));
  return (
    <div>
      <span>{label}</span>
      <strong>
        {value}/{limit}
      </strong>
      <i>
        <b style={{ width: `${percent}%` }} />
      </i>
    </div>
  );
}

function BillingInput({
  defaultValue,
  label,
  maxLength,
  name,
  required = true,
  type = "text",
}: {
  defaultValue: string;
  label: string;
  maxLength?: number;
  name: string;
  required?: boolean;
  type?: "text" | "email";
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        defaultValue={defaultValue}
        maxLength={maxLength}
        name={name}
        required={required}
        type={type}
      />
    </label>
  );
}
